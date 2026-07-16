package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// handleDeleteMe permanently deletes the account (App Store 5.1.1(v) /
// Play account-deletion requirements). Courts the user submitted survive
// with the submitter detached; everything else cascades.
func (s *Server) handleDeleteMe(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin delete", err)
		return
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)
	if _, err := tx.Exec(r.Context(), "LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE"); err != nil {
		s.internalError(w, "lock admin invariant", err)
		return
	}
	isAdmin, err := q.GetUserAdmin(r.Context(), uid)
	if err != nil {
		s.internalError(w, "get deleting user", err)
		return
	}
	if isAdmin {
		count, err := q.CountAdmins(r.Context())
		if err != nil {
			s.internalError(w, "count admins", err)
			return
		}
		if count <= 1 {
			writeError(w, http.StatusConflict, "transfer admin access before deleting the last admin")
			return
		}
	}
	if err := q.DetachUserFromCourts(r.Context(), &uid); err != nil {
		s.internalError(w, "detach courts", err)
		return
	}
	if err := q.DetachUserFromResolvedFlags(r.Context(), &uid); err != nil {
		s.internalError(w, "detach flags", err)
		return
	}
	n, err := q.DeleteUser(r.Context(), uid)
	if err != nil {
		s.internalError(w, "delete user", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit delete", err)
		return
	}
	if n == 0 {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	s.log.Info("account deleted", "user", uid)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBlockUser(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	uid := userID(r)
	if targetID == uid {
		writeError(w, http.StatusBadRequest, "you cannot block yourself")
		return
	}
	if err := s.store.Queries.BlockUser(r.Context(), gen.BlockUserParams{
		BlockerID: uid, BlockedID: targetID,
	}); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" { // FK: no such user
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		s.internalError(w, "block user", err)
		return
	}
	if err := s.store.Queries.DeleteFollowsBetween(r.Context(),
		gen.DeleteFollowsBetweenParams{FollowerID: uid, FolloweeID: targetID}); err != nil {
		s.internalError(w, "sever follows", err)
		return
	}
	if err := s.store.Queries.DeleteFollowRequestsBetween(r.Context(),
		gen.DeleteFollowRequestsBetweenParams{RequesterID: uid, TargetID: targetID}); err != nil {
		s.internalError(w, "sever follow requests", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUnblockUser(w http.ResponseWriter, r *http.Request) {
	targetID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.store.Queries.UnblockUser(r.Context(), gen.UnblockUserParams{
		BlockerID: userID(r), BlockedID: targetID,
	}); err != nil {
		s.internalError(w, "unblock user", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleListBlocked(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Queries.ListBlockedUsers(r.Context(), userID(r))
	if err != nil {
		s.internalError(w, "list blocked", err)
		return
	}
	if rows == nil {
		rows = []gen.ListBlockedUsersRow{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"blocked": rows})
}
