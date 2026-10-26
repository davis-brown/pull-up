package api

import (
	"net/http"

	"github.com/google/uuid"
)

// Every reportable public content type needs an action a moderator can take.
func (s *Server) handleAdminRemoveContent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type string `json:"entity_type"`
		ID   string `json:"entity_id"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	id, err := uuid.Parse(req.ID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid content id")
		return
	}
	statements := map[string][]string{
		"court":   {`UPDATE courts SET status='rejected' WHERE id=$1`},
		"photo":   {`UPDATE court_photos SET status='removed' WHERE id=$1`, `DELETE FROM media_reviews WHERE photo_id=$1`},
		"report":  {`DELETE FROM crowd_reports WHERE id=$1`},
		"message": {`UPDATE court_messages SET hidden_at=now() WHERE id=$1`},
		"session": {`UPDATE sessions SET canceled_at=now() WHERE id=$1`},
		"user": {
			`UPDATE users SET suspended_at=now(), avatar_url=NULL, display_name='Suspended player' WHERE id=$1`,
			`UPDATE court_messages SET hidden_at=now() WHERE user_id=$1`,
			`DELETE FROM crowd_reports WHERE user_id=$1`,
			`DELETE FROM run_intents WHERE user_id=$1`,
			`DELETE FROM session_rsvps WHERE user_id=$1`,
			`UPDATE sessions SET canceled_at=now() WHERE created_by=$1`,
			`UPDATE check_ins SET checked_out_at=now() WHERE user_id=$1 AND checked_out_at IS NULL`,
			`UPDATE court_photos SET status='removed' WHERE user_id=$1`,
			`DELETE FROM media_reviews WHERE owner_id=$1`,
			`UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
		},
	}
	queries, ok := statements[req.Type]
	if !ok {
		writeError(w, http.StatusBadRequest, "unsupported content type")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin content moderation", err)
		return
	}
	defer tx.Rollback(r.Context())
	if req.Type == "user" {
		var admin bool
		if err := tx.QueryRow(r.Context(), `SELECT is_admin FROM users WHERE id=$1 FOR UPDATE`, id).Scan(&admin); err != nil {
			writeError(w, http.StatusNotFound, "player not found")
			return
		}
		if admin {
			writeError(w, http.StatusConflict, "demote an administrator before suspending them")
			return
		}
	}
	for _, query := range queries {
		if _, err := tx.Exec(r.Context(), query, id); err != nil {
			s.internalError(w, "remove reported content", err)
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit content moderation", err)
		return
	}
	s.log.Info("content moderated", "admin", userID(r), "type", req.Type, "id", id)
	w.WriteHeader(http.StatusNoContent)
}
