package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func (s *Server) handleAdminSearchUsers(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, http.StatusOK, map[string]any{"users": []gen.SearchUsersRow{}})
		return
	}
	users, err := s.store.Queries.SearchUsers(r.Context(), q)
	if err != nil {
		s.internalError(w, "search users", err)
		return
	}
	if users == nil {
		users = []gen.SearchUsersRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

type setUserAdminRequest struct {
	IsAdmin bool `json:"is_admin"`
}

// handleAdminSetUserAdmin promotes or demotes a user. Demoting the last
// remaining admin is rejected so admins can never lock themselves out.
func (s *Server) handleAdminSetUserAdmin(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var req setUserAdminRequest
	if !readJSON(w, r, &req) {
		return
	}

	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin admin update", err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize every admin-role mutation with account deletion so two
	// concurrent operations cannot each observe another admin and remove both.
	if _, err := tx.Exec(r.Context(), "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		s.internalError(w, "lock admin invariant", err)
		return
	}
	q := s.store.Queries.WithTx(tx)
	actorAdmin, err := q.GetUserAdmin(r.Context(), userID(r))
	if err != nil || !actorAdmin {
		writeError(w, http.StatusForbidden, "admin only")
		return
	}
	target, err := q.GetUserByID(r.Context(), targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "get user", err)
		return
	}
	if !req.IsAdmin && target.IsAdmin {
		count, err := q.CountAdmins(r.Context())
		if err != nil {
			s.internalError(w, "count admins", err)
			return
		}
		if count <= 1 {
			writeError(w, http.StatusBadRequest, "cannot remove the last admin")
			return
		}
	}

	user, err := q.SetUserAdmin(r.Context(), gen.SetUserAdminParams{
		ID: targetID, IsAdmin: req.IsAdmin,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "set user admin", err)
		return
	}

	action := "demote"
	if req.IsAdmin {
		action = "promote"
	}
	if err := q.CreateAdminAction(r.Context(), gen.CreateAdminActionParams{
		ActorID: userID(r), Action: action, TargetUserID: targetID,
	}); err != nil {
		s.internalError(w, "create admin action", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit admin update", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) handleAdminClearAvatar(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.store.Queries.ClearUserAvatar(r.Context(), targetID); err != nil {
		s.internalError(w, "admin clear avatar", err)
		return
	}
	if err := s.store.Queries.CreateAdminAction(r.Context(), gen.CreateAdminActionParams{
		ActorID: userID(r), Action: "clear_avatar", TargetUserID: targetID,
	}); err != nil {
		s.log.Error("create admin action", "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminListActions(w http.ResponseWriter, r *http.Request) {
	actions, err := s.store.Queries.ListAdminActions(r.Context())
	if err != nil {
		s.internalError(w, "list admin actions", err)
		return
	}
	if actions == nil {
		actions = []gen.ListAdminActionsRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"actions": actions})
}
