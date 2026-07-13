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

// validStyleTags enumerates the allowed player-card style tags. Exported at
// package level (rather than inlined) so tests in this package can reference
// the same set of values.
var validStyleTags = []string{"shooter", "pass_first", "defense", "rim_runner", "casual", "competitive"}

var validPositions = map[string]bool{"guard": true, "wing": true, "forward": true, "center": true}

func isValidStyleTag(tag string) bool {
	for _, t := range validStyleTags {
		if t == tag {
			return true
		}
	}
	return false
}

type patchMeRequest struct {
	DisplayName  *string  `json:"display_name"`
	AvatarURL    *string  `json:"avatar_url"`
	IsPrivate    *bool    `json:"is_private"`
	JerseyNumber *int     `json:"jersey_number"`
	Position     *string  `json:"position"`
	HeightCm     *int     `json:"height_cm"`
	StyleTags    []string `json:"style_tags"`
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
	if req.JerseyNumber != nil && (*req.JerseyNumber < 0 || *req.JerseyNumber > 99) {
		writeError(w, http.StatusBadRequest, "jersey_number must be 0-99")
		return
	}
	if req.Position != nil && !validPositions[*req.Position] {
		writeError(w, http.StatusBadRequest, "position must be one of guard, wing, forward, center")
		return
	}
	if req.HeightCm != nil && (*req.HeightCm < 120 || *req.HeightCm > 250) {
		writeError(w, http.StatusBadRequest, "height_cm must be 120-250")
		return
	}
	if req.StyleTags != nil {
		if len(req.StyleTags) > 3 {
			writeError(w, http.StatusBadRequest, "style_tags must have at most 3 entries")
			return
		}
		for _, tag := range req.StyleTags {
			if !isValidStyleTag(tag) {
				writeError(w, http.StatusBadRequest, "invalid style tag: "+tag)
				return
			}
		}
	}
	var jerseyNumber *int16
	if req.JerseyNumber != nil {
		v := int16(*req.JerseyNumber)
		jerseyNumber = &v
	}
	var heightCm *int16
	if req.HeightCm != nil {
		v := int16(*req.HeightCm)
		heightCm = &v
	}
	user, err := s.store.Queries.UpdateUser(r.Context(), gen.UpdateUserParams{
		ID:           userID(r),
		DisplayName:  req.DisplayName,
		AvatarUrl:    req.AvatarURL,
		IsPrivate:    req.IsPrivate,
		JerseyNumber: jerseyNumber,
		Position:     req.Position,
		HeightCm:     heightCm,
		StyleTags:    req.StyleTags,
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
