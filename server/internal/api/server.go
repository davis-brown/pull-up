package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/davisbrown/pull-up/server/internal/auth"
	"github.com/davisbrown/pull-up/server/internal/config"
	"github.com/davisbrown/pull-up/server/internal/store"
)

type Server struct {
	cfg    *config.Config
	store  *store.Store
	issuer *auth.Issuer
	log    *slog.Logger
}

func NewServer(cfg *config.Config, st *store.Store, log *slog.Logger) *Server {
	return &Server{
		cfg:    cfg,
		store:  st,
		issuer: auth.NewIssuer(cfg.JWTSecret, cfg.AccessTokenTTL),
		log:    log,
	}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/auth/register", s.handleRegister)
		r.Post("/auth/login", s.handleLogin)
		r.Post("/auth/refresh", s.handleRefresh)
		r.Post("/auth/logout", s.handleLogout)

		r.Get("/courts", s.handleListCourts)
		r.Get("/courts/{id}", s.handleGetCourt)
		r.Get("/courts/{id}/activity", s.handleCourtActivity)

		// Authenticated routes.
		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)

			r.Get("/me", s.handleGetMe)
			r.Patch("/me", s.handlePatchMe)
			r.Get("/me/check-ins/current", s.handleCurrentCheckIn)

			r.Post("/courts", s.handleCreateCourt)
			r.Post("/courts/{id}/vote", s.handleVoteCourt)
			r.Post("/courts/{id}/check-ins", s.handleCheckIn)
			r.Post("/courts/{id}/reports", s.handleCreateReport)
			r.Delete("/check-ins/current", s.handleCheckOut)
			r.Post("/flags", s.handleCreateFlag)
		})
	})

	return r
}

// --- helpers ---

type apiError struct {
	Error   string `json:"error"`
	Details any    `json:"details,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Error: msg})
}

func readJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		}
		return false
	}
	return true
}
