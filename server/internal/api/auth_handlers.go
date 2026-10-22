package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/auth"
	"github.com/davisbrown/pull-up/server/internal/rules"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

type credentialsRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name,omitempty"`
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token,omitempty"`
	User         any    `json:"user"`
}

const (
	emailVerificationCodeHeader   = "X-Pull-Up-Email-Verification-Code"
	emailVerificationExpiryHeader = "X-Pull-Up-Email-Verification-Expires"
	emailVerificationToHeader     = "X-Pull-Up-Email-Verification-To"
	// Set to "existing-account" when someone registers an email that already
	// has an account: the Worker tells the owner instead of sending a code.
	emailKindHeader   = "X-Pull-Up-Email-Kind"
	refreshCookieName = "pullup_refresh"
)

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	parsedEmail, err := mail.ParseAddress(req.Email)
	if err != nil || parsedEmail.Address != req.Email || len(req.Email) > 254 {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if len(req.Password) < 8 || len(req.Password) > 72 {
		writeError(w, http.StatusBadRequest, "password must be 8-72 bytes")
		return
	}
	if req.DisplayName == "" || len(req.DisplayName) > 50 {
		writeError(w, http.StatusBadRequest, "display_name is required (max 50 chars)")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		s.internalError(w, "hash password", err)
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin registration", err)
		return
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)
	user, err := q.CreateUser(r.Context(), gen.CreateUserParams{
		Email:        req.Email,
		PasswordHash: &hash,
		DisplayName:  req.DisplayName,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The email belongs to a verified or OAuth account. Answer exactly as
		// for a new one, so registering can't reveal who has signed up, and
		// let the Worker tell the owner instead. The id is a decoy that no
		// code will ever match.
		decoy, _, err := auth.NewOpaqueToken()
		if err != nil {
			s.internalError(w, "create decoy verification id", err)
			return
		}
		if s.internalSecretValid(r) {
			w.Header().Set(emailKindHeader, "existing-account")
			w.Header().Set(emailVerificationToHeader, req.Email)
		}
		writeVerificationRequired(w, http.StatusAccepted, decoy)
		return
	}
	if err != nil {
		s.internalError(w, "create user", err)
		return
	}
	verificationID, code, expiresAt, err := s.issueEmailCode(r.Context(), q, user.ID)
	if err != nil {
		s.internalError(w, "issue email verification code", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit registration", err)
		return
	}
	s.setEmailCodeHeaders(w, r, code, expiresAt, req.Email)
	writeVerificationRequired(w, http.StatusAccepted, verificationID)
}

// issueEmailCode replaces a user's pending verification with a new id and
// code. The id goes to the client that just proved the password and the code
// only to the inbox, so verifying takes both: a squatter who registered
// someone else's email never sees the code, and the owner clicking or typing
// a code they didn't ask for can't activate the squatter's session.
func (s *Server) issueEmailCode(ctx context.Context, q *gen.Queries, userID uuid.UUID) (id, code string, expiresAt time.Time, err error) {
	// Also satisfies the one-active-token-per-user index.
	if err = q.InvalidateEmailVerificationTokens(ctx, userID); err != nil {
		return
	}
	id, idHash, err := auth.NewOpaqueToken()
	if err != nil {
		return
	}
	if code, err = auth.NewVerificationCode(); err != nil {
		return
	}
	expiresAt = time.Now().Add(s.cfg.EmailVerificationTTL)
	err = q.CreateEmailVerificationToken(ctx, gen.CreateEmailVerificationTokenParams{
		UserID: userID, TokenHash: idHash, CodeHash: emailCodeHash(id, code), ExpiresAt: expiresAt,
	})
	return
}

// emailCodeHash salts the 6-digit code with its verification id, which is
// stored only as a hash, so a leaked table can't be brute-forced offline.
func emailCodeHash(verificationID, code string) string {
	return auth.HashOpaqueToken(verificationID + ":" + code)
}

// setEmailCodeHeaders hands the code to the email Worker. The Worker injects
// X-Internal-Task, consumes these origin-only headers, and strips them before
// replying to the client.
func (s *Server) setEmailCodeHeaders(w http.ResponseWriter, r *http.Request, code string, expiresAt time.Time, to string) {
	if !s.internalSecretValid(r) {
		return
	}
	w.Header().Set(emailVerificationCodeHeader, code)
	w.Header().Set(emailVerificationExpiryHeader, expiresAt.UTC().Format(time.RFC3339))
	w.Header().Set(emailVerificationToHeader, to)
}

func writeVerificationRequired(w http.ResponseWriter, status int, verificationID string) {
	body := map[string]any{"verification_required": true, "verification_id": verificationID}
	if status == http.StatusForbidden {
		body["error"] = "email verification required"
	}
	writeJSON(w, status, body)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if !readJSON(w, r, &req) {
		return
	}
	user, err := s.store.Queries.GetUserByEmail(r.Context(), strings.TrimSpace(strings.ToLower(req.Email)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "invalid email or password")
			return
		}
		s.internalError(w, "get user", err)
		return
	}
	// OAuth-only accounts have no password to check.
	if user.PasswordHash == nil || !auth.CheckPassword(*user.PasswordHash, req.Password) {
		writeError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if !user.EmailVerified {
		// The password checks out, so this is the owner (or whoever set it)
		// coming back: send a fresh code to the inbox.
		tx, err := s.store.Pool.Begin(r.Context())
		if err != nil {
			s.internalError(w, "begin email code", err)
			return
		}
		defer tx.Rollback(r.Context())
		verificationID, code, expiresAt, err := s.issueEmailCode(r.Context(), s.store.Queries.WithTx(tx), user.ID)
		if err != nil {
			s.internalError(w, "issue email verification code", err)
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			s.internalError(w, "commit email code", err)
			return
		}
		s.setEmailCodeHeaders(w, r, code, expiresAt, user.Email)
		writeVerificationRequired(w, http.StatusForbidden, verificationID)
		return
	}
	publicUser := gen.GetUserByIDRow{
		ID: user.ID, Email: user.Email, DisplayName: user.DisplayName,
		AvatarUrl: user.AvatarUrl, Reputation: user.Reputation, CreatedAt: user.CreatedAt,
		IsAdmin: user.IsAdmin, IsPrivate: user.IsPrivate, JerseyNumber: user.JerseyNumber,
		Position: user.Position, HeightCm: user.HeightCm, StyleTags: user.StyleTags,
		EmailVerified: user.EmailVerified,
	}
	s.issueTokens(w, r, user.ID, publicUser)
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (s *Server) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if !readJSON(w, r, &req) {
		return
	}
	refreshToken := refreshTokenFromRequest(r, req.RefreshToken)
	if refreshToken == "" || len(refreshToken) > 256 {
		s.clearRefreshCookie(w, r)
		writeError(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin refresh rotation", err)
		return
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)
	row, err := q.GetRefreshTokenByHashForUpdate(r.Context(), auth.HashOpaqueToken(refreshToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.clearRefreshCookie(w, r)
			writeError(w, http.StatusUnauthorized, "invalid refresh token")
			return
		}
		s.internalError(w, "lock refresh token", err)
		return
	}
	now := time.Now()
	// A revoked token presented again is either a benign concurrent replay or
	// a stolen one, and an expired token must be inert either way. The rule is
	// in internal/rules so it can be tested without a database; see
	// TestRefreshExpiryIsCheckedBeforeReuse for why the order matters.
	switch rules.DecideRefresh(row.ExpiresAt, row.RevokedAt, now) {
	case rules.RefreshExpired:
		s.clearRefreshCookie(w, r)
		writeError(w, http.StatusUnauthorized, "refresh token expired")
		return
	case rules.RefreshReplayRevokeFamily:
		// Probable theft: cut every device loose. The revocation has to commit
		// even though the request is refused.
		if err := q.RevokeRefreshTokenFamily(r.Context(), row.FamilyID); err != nil {
			s.internalError(w, "revoke refresh token family", err)
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			s.internalError(w, "commit refresh family revocation", err)
			return
		}
		s.clearRefreshCookie(w, r)
		writeError(w, http.StatusUnauthorized, "refresh token reuse detected; please log in again")
		return
	case rules.RefreshReplayWithinGrace:
		// Reject without revoking the family, so the legitimate concurrent
		// request's rotated token remains valid.
		s.clearRefreshCookie(w, r)
		writeError(w, http.StatusUnauthorized, "refresh token reuse detected")
		return
	}

	if err := q.RevokeRefreshToken(r.Context(), row.ID); err != nil {
		s.internalError(w, "rotate refresh token", err)
		return
	}
	user, err := q.GetUserByID(r.Context(), row.UserID)
	if err != nil {
		s.internalError(w, "get user", err)
		return
	}
	access, err := s.issuer.IssueAccessToken(row.UserID, now)
	if err != nil {
		s.internalError(w, "issue access token", err)
		return
	}
	refresh, refreshHash, err := auth.NewOpaqueToken()
	if err != nil {
		s.internalError(w, "issue refresh token", err)
		return
	}
	if _, err := q.CreateRefreshToken(r.Context(), gen.CreateRefreshTokenParams{
		UserID: row.UserID, FamilyID: row.FamilyID, TokenHash: refreshHash,
		ExpiresAt: now.Add(s.cfg.RefreshTokenTTL),
	}); err != nil {
		s.internalError(w, "store rotated refresh token", err)
		return
	}
	// Forensic audit trail of the rotation chain. Replay detection itself is
	// the revoked_at grace window above, not this column.
	if err := q.SetRefreshTokenReplacement(r.Context(), gen.SetRefreshTokenReplacementParams{
		ID:             row.ID,
		ReplacedByHash: &refreshHash,
	}); err != nil {
		s.internalError(w, "set refresh token replacement", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit refresh rotation", err)
		return
	}
	s.writeTokenResponse(w, r, access, refresh, user)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if !readJSON(w, r, &req) {
		return
	}
	refreshToken := refreshTokenFromRequest(r, req.RefreshToken)
	s.clearRefreshCookie(w, r)
	if refreshToken == "" || len(refreshToken) > 256 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin logout", err)
		return
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)
	row, err := q.GetRefreshTokenByHashForUpdate(r.Context(), auth.HashOpaqueToken(refreshToken))
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		s.internalError(w, "lock logout token", err)
		return
	}
	// Only the current, unexpired token may log out its device family. Old or
	// expired leaked tokens cannot be turned into a forced-logout primitive.
	if rules.CanLogoutFamily(row.ExpiresAt, row.RevokedAt, time.Now()) {
		if err := q.RevokeRefreshTokenFamily(r.Context(), row.FamilyID); err != nil {
			s.internalError(w, "revoke logout token family", err)
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			s.internalError(w, "commit logout", err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) issueTokens(w http.ResponseWriter, r *http.Request, uid uuid.UUID, user any) {
	now := time.Now()
	access, err := s.issuer.IssueAccessToken(uid, now)
	if err != nil {
		s.internalError(w, "issue access token", err)
		return
	}
	refresh, refreshHash, err := auth.NewOpaqueToken()
	if err != nil {
		s.internalError(w, "issue refresh token", err)
		return
	}
	if _, err := s.store.Queries.CreateRefreshToken(r.Context(), gen.CreateRefreshTokenParams{
		UserID:    uid,
		FamilyID:  uuid.New(),
		TokenHash: refreshHash,
		ExpiresAt: now.Add(s.cfg.RefreshTokenTTL),
	}); err != nil {
		s.internalError(w, "store refresh token", err)
		return
	}
	s.writeTokenResponse(w, r, access, refresh, user)
}

type emailVerificationRequest struct {
	VerificationID string `json:"verification_id"`
	Code           string `json:"code,omitempty"`
}

// handleRequestEmailVerification sends a new code for a pending verification.
// It answers the same whatever the id, so it reveals nothing.
func (s *Server) handleRequestEmailVerification(w http.ResponseWriter, r *http.Request) {
	var req emailVerificationRequest
	if !readJSON(w, r, &req) {
		return
	}
	accepted := map[string]string{"status": "if the verification is pending, a new code will be sent"}
	// Only reachable from the API Worker, which applies its own rate limits.
	// The internal secret gate is defense-in-depth against direct access.
	if !s.internalSecretValid(r) || req.VerificationID == "" || len(req.VerificationID) > 256 {
		writeJSON(w, http.StatusAccepted, accepted)
		return
	}
	code, err := auth.NewVerificationCode()
	if err != nil {
		s.internalError(w, "create email verification code", err)
		return
	}
	expiresAt := time.Now().Add(s.cfg.EmailVerificationTTL)
	email, err := s.store.Queries.ReissueEmailVerificationCode(r.Context(), gen.ReissueEmailVerificationCodeParams{
		TokenHash: auth.HashOpaqueToken(req.VerificationID),
		CodeHash:  emailCodeHash(req.VerificationID, code),
		ExpiresAt: expiresAt,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "reissue email verification code", err)
		return
	}
	if err == nil {
		s.setEmailCodeHeaders(w, r, code, expiresAt, email)
	}
	writeJSON(w, http.StatusAccepted, accepted)
}

func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req emailVerificationRequest
	if !readJSON(w, r, &req) {
		return
	}
	code := strings.ReplaceAll(req.Code, " ", "")
	if req.VerificationID == "" || len(req.VerificationID) > 256 || len(code) != 6 {
		writeError(w, http.StatusBadRequest, "invalid or expired code")
		return
	}
	attempt, err := s.store.Queries.ClaimEmailVerificationAttempt(
		r.Context(), auth.HashOpaqueToken(req.VerificationID))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "invalid or expired code")
		return
	}
	if err != nil {
		s.internalError(w, "claim email verification attempt", err)
		return
	}
	if subtle.ConstantTimeCompare([]byte(emailCodeHash(req.VerificationID, code)), []byte(attempt.CodeHash)) != 1 {
		writeError(w, http.StatusBadRequest, "invalid or expired code")
		return
	}
	user, err := s.store.Queries.VerifyEmailWithToken(r.Context(), attempt.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "invalid or expired code")
			return
		}
		s.internalError(w, "verify email", err)
		return
	}
	s.issueTokens(w, r, user.ID, user)
}

func (s *Server) internalError(w http.ResponseWriter, op string, err error) {
	s.log.Error(op, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func isWebClient(r *http.Request) bool {
	return r.Header.Get("X-Pull-Up-Platform") == "web"
}

func refreshTokenFromRequest(r *http.Request, bodyToken string) string {
	if !isWebClient(r) {
		return bodyToken
	}
	if cookie, err := r.Cookie(refreshCookieName); err == nil {
		return cookie.Value
	}
	// One migration request may exchange a legacy localStorage token for the
	// HttpOnly cookie. New web clients send an empty body thereafter.
	return bodyToken
}

func (s *Server) writeTokenResponse(
	w http.ResponseWriter,
	r *http.Request,
	accessToken string,
	refreshToken string,
	user any,
) {
	response := tokenResponse{AccessToken: accessToken, RefreshToken: refreshToken, User: user}
	if isWebClient(r) {
		s.setRefreshCookie(w, r, refreshToken)
		response.RefreshToken = ""
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) setRefreshCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := r.Header.Get("X-Forwarded-Proto") == "https" || r.TLS != nil
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     "/api/v1/auth",
		Expires:  time.Now().Add(s.cfg.RefreshTokenTTL),
		MaxAge:   int(s.cfg.RefreshTokenTTL.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) clearRefreshCookie(w http.ResponseWriter, r *http.Request) {
	if !isWebClient(r) {
		return
	}
	secure := r.Header.Get("X-Forwarded-Proto") == "https" || r.TLS != nil
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    "",
		Path:     "/api/v1/auth",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}
