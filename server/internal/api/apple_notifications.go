package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Register this URL on the primary App ID. Only Apple's signed notifications
// can change account state; event_time makes duplicate/out-of-order delivery safe.
func (s *Server) handleAppleNotification(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Payload string `json:"payload"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	event, err := s.oauth.VerifyAppleEvent(r.Context(), req.Payload)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid Apple notification")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin Apple notification", err)
		return
	}
	defer tx.Rollback(r.Context())
	var uid uuid.UUID
	err = tx.QueryRow(r.Context(), `UPDATE users SET apple_event_time=$2 WHERE auth_provider='apple' AND oauth_subject=$1 AND apple_event_time<$2 RETURNING id`, event.Subject, event.Time).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		s.internalError(w, "apply Apple event", err)
		return
	}
	if event.Type == "account-deleted" {
		// Do not acknowledge the event in storage until deletion succeeds.
		// Failed deletion must remain retryable by Apple's next delivery.
		_ = tx.Rollback(r.Context())
		s.handleDeleteMe(w, r.WithContext(context.WithValue(r.Context(), userIDKey, uid)))
		return
	}
	switch event.Type {
	case "email-enabled", "email-disabled":
		_, err = tx.Exec(r.Context(), `UPDATE users SET apple_email_forwarding=$2 WHERE id=$1`, uid, event.Type == "email-enabled")
	case "consent-revoked":
		_, err = tx.Exec(r.Context(), `UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, uid)
	default:
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		s.internalError(w, "update Apple account state", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit Apple event", err)
		return
	}
	w.WriteHeader(http.StatusOK)
}
