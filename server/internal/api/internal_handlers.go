package api

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func (s *Server) handleInternalVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"version": s.cfg.Version,
		"commit":  s.cfg.Commit,
	})
}

// handleInternalDrain lets an external scheduler (Cloudflare cron, GitHub
// Actions, any pinger) advance the background queues for a bounded window, so
// backlog drains even with no organic traffic. Secret-guarded; not in the
// public or requireAuth groups.
func (s *Server) handleInternalDrain(w http.ResponseWriter, r *http.Request) {
	deadline := time.Now().Add(50 * time.Second)
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()
	tiles, courts := 0, 0
	for time.Now().Before(deadline) {
		did := false
		if s.seeder != nil && s.seeder.DrainOnce(ctx) {
			tiles++
			did = true
		}
		if s.enricher != nil && s.enricher.DrainOnce(ctx) {
			courts++
			did = true
		}
		if !did {
			break // nothing claimable
		}
	}
	stale, err := s.drainStalePendingUploads(ctx)
	if err != nil {
		s.internalError(w, "drain stale pending uploads", err)
		return
	}
	// Self-limiting: each pass only touches players whose local clock is in
	// the evening window, and each is gated to one nudge per 6 days.
	nudges := s.runStreakNudges(ctx)
	// Unconfirmed games simply stop existing after 48h.
	expiredGames, err := s.store.Queries.ExpireUnconfirmedGames(ctx)
	if err != nil {
		s.log.Error("expire unconfirmed games", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tiles": tiles, "courts": courts, "stale_pending_uploads": stale,
		"streak_nudges": nudges, "expired_games": expiredGames,
	})
}

func (s *Server) drainStalePendingUploads(ctx context.Context) (int, error) {
	const batchSize = 50
	total := 0
	for {
		keys, err := s.store.Queries.ListStalePendingUploads(ctx, batchSize)
		if err != nil {
			return total, err
		}
		if len(keys) == 0 {
			return total, nil
		}
		tx, err := s.store.Pool.Begin(ctx)
		if err != nil {
			return total, err
		}
		q := s.store.Queries.WithTx(tx)
		for _, key := range keys {
			if err := q.ScheduleUploadedObjectCleanup(ctx, key); err != nil {
				tx.Rollback(ctx)
				return total, err
			}
		}
		if _, err := q.DeletePendingUploads(ctx, keys); err != nil {
			tx.Rollback(ctx)
			return total, err
		}
		if err := tx.Commit(ctx); err != nil {
			return total, err
		}
		total += len(keys)
		if len(keys) < batchSize {
			return total, nil
		}
	}
}

type mediaKeyRequest struct {
	Key string `json:"key"`
}

func (s *Server) handleInternalAuthorizeMedia(w http.ResponseWriter, r *http.Request) {
	var req mediaKeyRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Key = strings.TrimSpace(req.Key)
	if !validStorageKey(req.Key) {
		writeError(w, http.StatusBadRequest, "invalid media key")
		return
	}
	authorized, err := s.store.Queries.IsMediaKeyAuthorized(r.Context(), req.Key)
	if err != nil {
		s.internalError(w, "authorize media", err)
		return
	}
	if !authorized {
		writeError(w, http.StatusNotFound, "media key not authorized")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleInternalMediaUploaded(w http.ResponseWriter, r *http.Request) {
	var req mediaKeyRequest
	if !readJSON(w, r, &req) {
		return
	}
	req.Key = strings.TrimSpace(req.Key)
	if !validStorageKey(req.Key) {
		writeError(w, http.StatusBadRequest, "invalid media key")
		return
	}
	tx, err := s.store.Pool.Begin(r.Context())
	if err != nil {
		s.internalError(w, "begin media upload finalization", err)
		return
	}
	defer tx.Rollback(r.Context())
	q := s.store.Queries.WithTx(tx)
	if strings.HasPrefix(req.Key, "courts/") {
		n, err := q.MarkCourtPhotoUploaded(r.Context(), req.Key)
		if err != nil {
			s.internalError(w, "mark court photo uploaded", err)
			return
		}
		if n == 0 {
			writeError(w, http.StatusNotFound, "photo metadata not found")
			return
		}
	}
	// Do NOT remove the pending-upload record here. This fires during the
	// upload PUT, before the client's PATCH /me claims the row via
	// ClaimPendingUpload; deleting it now breaks every avatar upload.
	// Abandoned rows are reaped by drainStalePendingUploads instead.
	if err := q.ScheduleUploadedObjectCleanup(r.Context(), req.Key); err != nil {
		s.internalError(w, "schedule abandoned upload cleanup", err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, "commit media upload finalization", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type claimObjectDeletionsRequest struct {
	Limit int32 `json:"limit,omitempty"`
}

func (s *Server) handleInternalClaimObjectDeletions(w http.ResponseWriter, r *http.Request) {
	var req claimObjectDeletionsRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Limit == 0 {
		req.Limit = 50
	}
	if req.Limit < 1 || req.Limit > 100 {
		writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
		return
	}
	keys, err := s.store.Queries.ClaimObjectDeletions(r.Context(), req.Limit)
	if err != nil {
		s.internalError(w, "claim object deletions", err)
		return
	}
	if keys == nil {
		keys = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"keys": keys})
}

type ackObjectDeletionsRequest struct {
	Keys []string `json:"keys"`
}

func (s *Server) handleInternalAckObjectDeletions(w http.ResponseWriter, r *http.Request) {
	var req ackObjectDeletionsRequest
	if !readJSON(w, r, &req) {
		return
	}
	if len(req.Keys) == 0 || len(req.Keys) > 100 {
		writeError(w, http.StatusBadRequest, "keys must contain 1-100 entries")
		return
	}
	for _, key := range req.Keys {
		if !validStorageKey(key) {
			writeError(w, http.StatusBadRequest, "invalid media key")
			return
		}
	}
	n, err := s.store.Queries.AckObjectDeletions(r.Context(), req.Keys)
	if err != nil {
		s.internalError(w, "ack object deletions", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"acked": n})
}

func validStorageKey(key string) bool {
	return key != "" && len(key) <= 500 && !strings.HasPrefix(key, "/") &&
		!strings.Contains(key, "..") && !strings.ContainsAny(key, "\\\x00")
}

type resolveExternalPhotoRequest struct {
	Source   string `json:"source"`
	SourceID string `json:"source_id"`
}

// externalSourceID matches the numeric ids both auto-photo sources produce.
// Bounding the shape stops a caller probing arbitrary rows, and mirrors the
// Worker's key regex.
var externalSourceID = regexp.MustCompile(`^[0-9]{1,20}$`)

// handleInternalResolveExternalPhoto backs the Worker's read-through R2 cache,
// returning a photo's upstream URL only while the row is visible. A hidden or
// unknown photo 404s, so moderation takes effect on the next read whatever the
// Worker already cached.
func (s *Server) handleInternalResolveExternalPhoto(w http.ResponseWriter, r *http.Request) {
	var req resolveExternalPhotoRequest
	if !readJSON(w, r, &req) {
		return
	}
	if req.Source != "commons" && req.Source != "mapillary" {
		writeError(w, http.StatusBadRequest, "invalid photo source")
		return
	}
	if !externalSourceID.MatchString(req.SourceID) {
		writeError(w, http.StatusBadRequest, "invalid photo source id")
		return
	}
	imageURL, err := s.store.Queries.GetVisibleExternalPhotoURL(r.Context(), gen.GetVisibleExternalPhotoURLParams{
		Source: req.Source, SourceID: req.SourceID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "external photo not found")
			return
		}
		s.internalError(w, "resolve external photo", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"image_url": imageURL})
}
