package api

import (
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/davisbrown/pull-up/server/internal/auth"
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
	emailVerificationTokenHeader  = "X-Pull-Up-Email-Verification-Token"
	emailVerificationExpiryHeader = "X-Pull-Up-Email-Verification-Expires"
	emailVerificationToHeader     = "X-Pull-Up-Email-Verification-To"
	refreshCookieName             = "pullup_refresh"
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
	verificationToken, verificationHash, err := auth.NewEmailVerificationToken()
	if err != nil {
		s.internalError(w, "create email verification token", err)
		return
	}
	expiresAt := time.Now().Add(s.cfg.EmailVerificationTTL)
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
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeError(w, http.StatusConflict, "an account with that email already exists")
			return
		}
		s.internalError(w, "create user", err)
		return
	}
	if err := q.CreateEmailVerificationToken(r.Context(), gen.CreateEmailVerificationTokenParams{
		UserID: user.ID, TokenHash: verificationHash, ExpiresAt: expiresAt,
	}); err != nil {
		s.internalError(w, "store email verification token", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit registration", err)
		return
	}
	// A trusted reverse proxy/email Worker injects X-Internal-Task, consumes
	// these origin-only headers, and strips them before replying to the client.
	if s.internalSecretValid(r) {
		w.Header().Set(emailVerificationTokenHeader, verificationToken)
		w.Header().Set(emailVerificationExpiryHeader, expiresAt.UTC().Format(time.RFC3339))
		w.Header().Set(emailVerificationToHeader, req.Email)
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"verification_required": true,
		"user":                  user,
	})
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
		writeError(w, http.StatusForbidden, "email verification required")
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
	row, err := q.GetRefreshTokenByHashForUpdate(r.Context(), auth.HashRefreshToken(refreshToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.clearRefreshCookie(w, r)
			writeError(w, http.StatusUnauthorized, "invalid refresh token")
			return
		}
		s.internalError(w, "lock refresh token", err)
		return
	}
	const refreshReplayGrace = 5 * time.Second
	now := time.Now()
	// Expiry is checked before reuse. An expired, previously rotated token is
	// inert and cannot be used to force-log-out the still-current family.
	if !now.Before(row.ExpiresAt) {
		s.clearRefreshCookie(w, r)
		writeError(w, http.StatusUnauthorized, "refresh token expired")
		return
	}
	if row.RevokedAt != nil {
		// A revoked token presented again is either a benign concurrent replay
		// (e.g., two tabs racing) or an attacker replaying a stolen token. We
		// allow a short grace window before treating it as theft and revoking
		// the whole family. In either case we refuse the refresh.
		if now.Sub(*row.RevokedAt) > refreshReplayGrace {
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
		}
		// Within the grace window: reject without revoking the family so the
		// legitimate concurrent request's rotated token remains valid.
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
	refresh, refreshHash, err := auth.NewRefreshToken()
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
	// Record which token replaced this one as a forensic audit trail of the
	// rotation chain. Benign-vs-malicious replay detection itself is handled by
	// the revoked_at grace window above, not by this column.
	if row.RevokedAt == nil {
		replacementHash := &refreshHash
		if err := q.SetRefreshTokenReplacement(r.Context(), gen.SetRefreshTokenReplacementParams{
			ID:             row.ID,
			ReplacedByHash: replacementHash,
		}); err != nil {
			s.internalError(w, "set refresh token replacement", err)
			return
		}
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
	row, err := q.GetRefreshTokenByHashForUpdate(r.Context(), auth.HashRefreshToken(refreshToken))
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
	if row.RevokedAt == nil && time.Now().Before(row.ExpiresAt) {
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
	refresh, refreshHash, err := auth.NewRefreshToken()
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
	Email string `json:"email"`
}

func (s *Server) handleRequestEmailVerification(w http.ResponseWriter, r *http.Request) {
	var req emailVerificationRequest
	if !readJSON(w, r, &req) {
		return
	}
	// This route is only reachable from the API Worker, which forwards the
	// public resend request after applying its own rate limits. The internal
	// secret gate is defense-in-depth against direct container access.
	if !s.internalSecretValid(r) {
		writeJSON(w, http.StatusAccepted, map[string]string{
			"status": "if the account is eligible, a verification message will be sent",
		})
		return
	}
	token, expiresAt, eligible, err := s.createEmailVerificationToken(
		r, strings.TrimSpace(strings.ToLower(req.Email)))
	if err != nil {
		s.internalError(w, "create email verification token", err)
		return
	}
	if eligible {
		w.Header().Set(emailVerificationTokenHeader, token)
		w.Header().Set(emailVerificationExpiryHeader, expiresAt.UTC().Format(time.RFC3339))
		w.Header().Set(emailVerificationToHeader, strings.TrimSpace(strings.ToLower(req.Email)))
	}
	writeJSON(w, http.StatusAccepted, map[string]string{
		"status": "if the account is eligible, a verification message will be sent",
	})
}

func (s *Server) createEmailVerificationToken(r *http.Request, email string) (string, time.Time, bool, error) {
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		return "", time.Time{}, false, err
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)
	uid, err := q.GetUnverifiedPasswordUserByEmailForUpdate(r.Context(), email)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	// A resend creates a fresh token. Invalidate any unconsumed token so the
	// unique one-active-token-per-user constraint is satisfied and the latest
	// emailed token is the only one that can be verified.
	if err := q.InvalidateEmailVerificationTokens(r.Context(), uid); err != nil {
		return "", time.Time{}, false, err
	}
	token, hash, err := auth.NewEmailVerificationToken()
	if err != nil {
		return "", time.Time{}, false, err
	}
	expiresAt := time.Now().Add(s.cfg.EmailVerificationTTL)
	if err := q.CreateEmailVerificationToken(r.Context(), gen.CreateEmailVerificationTokenParams{
		UserID: uid, TokenHash: hash, ExpiresAt: expiresAt,
	}); err != nil {
		return "", time.Time{}, false, err
	}
	if err := tx.Commit(r.Context()); err != nil {
		return "", time.Time{}, false, err
	}
	return token, expiresAt, true, nil
}

type verifyEmailRequest struct {
	Token string `json:"token"`
}

func (s *Server) handleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyEmailRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Token == "" || len(req.Token) > 256 {
		writeError(w, http.StatusBadRequest, "invalid or expired verification token")
		return
	}
	user, err := s.store.Queries.VerifyEmailWithToken(
		r.Context(), auth.HashEmailVerificationToken(req.Token))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusBadRequest, "invalid or expired verification token")
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
