package api

import (
	"net/http"
	"time"
)

// handleInternalDrain lets an external scheduler (Cloudflare cron, GitHub
// Actions, any pinger) advance the background queues for a bounded window, so
// backlog drains even with no organic traffic. Secret-guarded; not in the
// public or requireAuth groups.
func (s *Server) handleInternalDrain(w http.ResponseWriter, r *http.Request) {
	if s.cfg.InternalTaskSecret == "" || r.Header.Get("X-Internal-Task") != s.cfg.InternalTaskSecret {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	deadline := time.Now().Add(50 * time.Second)
	tiles, courts := 0, 0
	for time.Now().Before(deadline) {
		did := false
		if s.seeder != nil && s.seeder.DrainOnce(r.Context()) {
			tiles++
			did = true
		}
		if s.enricher != nil && s.enricher.DrainOnce(r.Context()) {
			courts++
			did = true
		}
		if !did {
			break // nothing claimable
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tiles": tiles, "courts": courts})
}
