package api

import (
	"net/http"
	"strings"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func (s *Server) handleGetMe(w http.ResponseWriter, r *http.Request) {
	user, err := s.store.Queries.GetUserByID(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "get me", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

type patchMeRequest struct {
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
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
	})
	if err != nil {
		s.internalError(w, "update user", err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}
