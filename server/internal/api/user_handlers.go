package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.Queries.GetUserByID(r.Context(), userID(r))
	if err != nil {
		// A valid token can outlive the account (deleted account): 401 so
		// the client clears its session instead of retrying.
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "account no longer exists")
			return
		}
		s.internalError(w, "get me", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

type patchMeRequest struct {
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	IsPrivate   *bool   `json:"is_private"`
}

func (s *Server) handlePatchMe(w http.ResponseWriter, r *http.Request) {
	var req patchMeRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.DisplayName != nil {
		trimmed := strings.TrimSpace(*req.DisplayName)
		if trimmed == "" || len(trimmed) > 50 {
			writeError(w, http.StatusBadRequest, "display_name must be 1-50 characters")
			return
		}
		req.DisplayName = &trimmed
	}
	user, err := s.store.Queries.UpdateUser(r.Context(), gen.UpdateUserParams{
		ID:          userID(r),
		DisplayName: req.DisplayName,
		AvatarUrl:   req.AvatarURL,
		IsPrivate:   req.IsPrivate,
	})
	if err != nil {
		s.internalError(w, "update user", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) handleCreateAvatarUpload(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	key := fmt.Sprintf("avatars/%s/%s.jpg", uid, uuid.NewString())
	exp := time.Now().Add(uploadURLTTL).Unix()
	writeJSON(w, http.StatusOK, map[string]any{
		"avatar_url": "/photos/" + key,
		"upload_path": fmt.Sprintf("/photos/upload/%s?exp=%d&sig=%s",
			key, exp, signUpload(s.cfg.JWTSecret, key, exp)),
	})
}

func (s *Server) handleDeleteAvatar(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Queries.ClearUserAvatar(r.Context(), userID(r)); err != nil {
		s.internalError(w, "clear avatar", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
