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
	RefreshToken string `json:"refresh_token"`
	User         any    `json:"user"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.DisplayName = strings.TrimSpace(req.DisplayName)
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
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
	user, err := s.store.Queries.CreateUser(r.Context(), gen.CreateUserParams{
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
	s.issueTokens(w, r, user.ID, user)
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
	publicUser := gen.GetUserByIDRow{
		ID: user.ID, Email: user.Email, DisplayName: user.DisplayName,
		AvatarUrl: user.AvatarUrl, Reputation: user.Reputation, CreatedAt: user.CreatedAt,
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
	row, err := s.store.Queries.GetRefreshTokenByHash(r.Context(), auth.HashRefreshToken(req.RefreshToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "invalid refresh token")
			return
		}
		s.internalError(w, "get refresh token", err)
		return
	}
	if row.RevokedAt != nil {
		// Reuse of a rotated token — likely theft. Revoke the whole family.
		if err := s.store.Queries.RevokeAllUserRefreshTokens(r.Context(), row.UserID); err != nil {
			s.log.Error("revoke token family", "err", err)
		}
		writeError(w, http.StatusUnauthorized, "refresh token reuse detected; please log in again")
		return
	}
	if time.Now().After(row.ExpiresAt) {
		writeError(w, http.StatusUnauthorized, "refresh token expired")
		return
	}
	if err := s.store.Queries.RevokeRefreshToken(r.Context(), row.ID); err != nil {
		s.internalError(w, "rotate refresh token", err)
		return
	}
	user, err := s.store.Queries.GetUserByID(r.Context(), row.UserID)
	if err != nil {
		s.internalError(w, "get user", err)
		return
	}
	s.issueTokens(w, r, row.UserID, user)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if !readJSON(w, r, &req) {
		return
	}
	row, err := s.store.Queries.GetRefreshTokenByHash(r.Context(), auth.HashRefreshToken(req.RefreshToken))
	if err == nil {
		_ = s.store.Queries.RevokeRefreshToken(r.Context(), row.ID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) issueTokens(w http.ResponseWriter, r *http.Request, uid uuid.UUID, user any) {
	access, err := s.issuer.IssueAccessToken(uid, time.Now())
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
		TokenHash: refreshHash,
		ExpiresAt: time.Now().Add(s.cfg.RefreshTokenTTL),
	}); err != nil {
		s.internalError(w, "store refresh token", err)
		return
	}
	writeJSON(w, http.StatusOK, tokenResponse{AccessToken: access, RefreshToken: refresh, User: user})
}

func (s *Server) internalError(w http.ResponseWriter, op string, err error) {
	s.log.Error(op, "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}
