package api

import "net/http"

const contentConsentVersion = "2026-10-26"

func (s *Server) handleContentConsent(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req struct {
			Version string `json:"version"`
		}
		if !readJSON(w, r, &req) {
			return
		}
		if req.Version != contentConsentVersion {
			writeError(w, http.StatusBadRequest, "review the current community terms")
			return
		}
		if _, err := s.store.Pool.Exec(r.Context(), `UPDATE users SET content_consent_version=$2 WHERE id=$1`, userID(r), req.Version); err != nil {
			s.internalError(w, "record content consent", err)
			return
		}
	}
	var version string
	if err := s.store.Pool.QueryRow(r.Context(), `SELECT content_consent_version FROM users WHERE id=$1`, userID(r)).Scan(&version); err != nil {
		s.internalError(w, "read content consent", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accepted": version == contentConsentVersion, "version": contentConsentVersion})
}
