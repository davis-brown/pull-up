package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Pre-publication review is deliberately human-operated. Preview URLs are
// short-lived, scoped to one object, and only issued to authenticated admins.
func (s *Server) handleAdminMediaReviews(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.Pool.Query(r.Context(), `SELECT storage_key, purpose FROM media_reviews ORDER BY created_at LIMIT 100`)
	if err != nil {
		s.internalError(w, "list media reviews", err)
		return
	}
	defer rows.Close()
	reviews := []map[string]string{}
	for rows.Next() {
		var key, purpose string
		if err := rows.Scan(&key, &purpose); err != nil {
			s.internalError(w, "read media review", err)
			return
		}
		exp := time.Now().Add(5 * time.Minute).Unix()
		token := fmt.Sprintf("%d.%s", exp, signUpload(s.cfg.UploadSigningSecret, "review:"+key, exp))
		reviews = append(reviews, map[string]string{"key": key, "purpose": purpose, "preview_path": "/photos/" + key + "?review=" + url.QueryEscape(token)})
	}
	if err := rows.Err(); err != nil {
		s.internalError(w, "read media reviews", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"reviews": reviews})
}

func (s *Server) handleAdminReviewMedia(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Key     string `json:"key"`
		Approve bool   `json:"approve"`
	}
	if !readJSON(w, r, &req) {
		return
	}
	if !isAllowedPhotoKey(req.Key) {
		writeError(w, http.StatusBadRequest, "invalid media key")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin media review", err)
		return
	}
	defer tx.Rollback(r.Context())
	var purpose string
	var owner uuid.UUID
	var photo *uuid.UUID
	err = tx.QueryRow(r.Context(), `SELECT owner_id, purpose, photo_id FROM media_reviews WHERE storage_key=$1 FOR UPDATE`, req.Key).Scan(&owner, &purpose, &photo)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "review not found")
		return
	}
	if err != nil {
		s.internalError(w, "lock media review", err)
		return
	}
	if purpose == "court" {
		status := "removed"
		if req.Approve {
			status = "visible"
		}
		_, err = tx.Exec(r.Context(), `UPDATE court_photos SET status=$2 WHERE id=$1 AND status IN ('pending','flagged')`, photo, status)
	} else if req.Approve {
		_, err = tx.Exec(r.Context(), `UPDATE users SET avatar_url=$2 WHERE id=$1`, owner, "/photos/"+req.Key)
	}
	if err != nil {
		s.internalError(w, "apply media review", err)
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM media_reviews WHERE storage_key=$1`, req.Key); err != nil {
		s.internalError(w, "finish media review", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit media review", err)
		return
	}
	s.log.Info("media reviewed", "admin", userID(r), "approved", req.Approve)
	w.WriteHeader(http.StatusNoContent)
}
