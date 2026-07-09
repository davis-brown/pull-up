package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/davisbrown/pull-up/server/internal/auth"
	"github.com/davisbrown/pull-up/server/internal/config"
	"github.com/davisbrown/pull-up/server/internal/enrich"
	"github.com/davisbrown/pull-up/server/internal/seeder"
	"github.com/davisbrown/pull-up/server/internal/store"
)

type Server struct {
	cfg      *config.Config
	store    *store.Store
	issuer   *auth.Issuer
	oauth    *auth.OAuthVerifier
	log      *slog.Logger
	seeder   *seeder.Seeder   // nil when auto-seeding is disabled
	enricher *enrich.Enricher // nil when enrichment is disabled
}

func NewServer(cfg *config.Config, st *store.Store, log *slog.Logger, sd *seeder.Seeder, en *enrich.Enricher) *Server {
	return &Server{
		cfg:      cfg,
		store:    st,
		issuer:   auth.NewIssuer(cfg.JWTSecret, cfg.AccessTokenTTL),
		oauth:    auth.NewOAuthVerifier(cfg.GoogleClientIDs, cfg.AppleAudiences),
		log:      log,
		seeder:   sd,
		enricher: en,
	}
}

// requestSeeding kicks off background OSM imports for any never-seeded tiles
// in the viewport. Non-blocking; no-op when auto-seeding is off.
func (s *Server) requestSeeding(minLng, minLat, maxLng, maxLat float64) {
	if s.seeder != nil {
		s.seeder.Request(minLng, minLat, maxLng, maxLat)
	}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(sentryReporter)
	// Auth is Bearer-token based (no cookies), so a permissive default is
	// fine; tighten with CORS_ORIGINS=https://app.example.com in production.
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: s.cfg.CORSOrigins,
		AllowedMethods: []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
		MaxAge:         600,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			// Brute-force guard: covers register, login, refresh, logout, oauth.
			if s.cfg.RateLimitAuthPerMin > 0 {
				r.Use(perIPLimit(s.cfg.RateLimitAuthPerMin, time.Minute))
			}
			r.Post("/auth/register", s.handleRegister)
			r.Post("/auth/login", s.handleLogin)
			r.Post("/auth/refresh", s.handleRefresh)
			r.Post("/auth/logout", s.handleLogout)
			r.Post("/auth/oauth", s.handleOAuth)
		})

		r.Get("/courts", s.handleListCourts)
		r.Get("/courts/{id}", s.handleGetCourt)
		r.Get("/courts/{id}/activity", s.handleCourtActivity)
		r.Get("/courts/{id}/photos", s.handleListPhotos)
		r.Get("/courts/{id}/sessions", s.handleListSessions) // personalizes via optional bearer
		r.Get("/courts/{id}/messages", s.handleListMessages)
		r.Get("/sessions/{id}/attendees", s.handleSessionAttendees)

		// Authenticated routes.
		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)
			if s.cfg.RateLimitWritePerMin > 0 {
				r.Use(writeLimiter(s.cfg.RateLimitWritePerMin, time.Minute))
			}

			r.Get("/me", s.handleGetMe)
			r.Patch("/me", s.handlePatchMe)
			r.Delete("/me", s.handleDeleteMe)
			r.Get("/me/blocked", s.handleListBlocked)
			r.Put("/users/{id}/block", s.handleBlockUser)
			r.Delete("/users/{id}/block", s.handleUnblockUser)
			r.Get("/me/check-ins/current", s.handleCurrentCheckIn)
			r.Get("/me/check-ins", s.handleCheckInHistory)
			r.Get("/me/favorites", s.handleListFavorites)
			r.Post("/me/push-token", s.handleRegisterPushToken)

			r.Post("/courts", s.handleCreateCourt)
			r.Post("/courts/{id}/vote", s.handleVoteCourt)
			r.Post("/courts/{id}/check-ins", s.handleCheckIn)
			r.Post("/courts/{id}/reports", s.handleCreateReport)
			r.Post("/courts/{id}/photos", s.handleCreatePhoto)
			r.Put("/courts/{id}/favorite", s.handleAddFavorite)
			r.Delete("/courts/{id}/favorite", s.handleRemoveFavorite)
			r.Get("/courts/{id}/favorite", s.handleIsFavorite)
			r.Delete("/check-ins/current", s.handleCheckOut)
			r.Post("/flags", s.handleCreateFlag)

			r.Post("/courts/{id}/sessions", s.handleCreateSession)
			r.Post("/courts/{id}/messages", s.handleCreateMessage)
			r.Delete("/sessions/{id}", s.handleCancelSession)
			r.Put("/sessions/{id}/rsvp", s.handleRSVP)

			// Moderation. The first admin is bootstrapped out-of-band (SQL);
			// every admin after that is promoted through the API below.
			r.Group(func(r chi.Router) {
				r.Use(s.requireAdmin)
				r.Get("/admin/flags", s.handleListFlags)
				r.Post("/admin/flags/{id}/resolve", s.handleResolveFlag)
				r.Post("/admin/courts/{id}/status", s.handleAdminSetCourtStatus)
				r.Post("/admin/photos/{id}/status", s.handleAdminSetPhotoStatus)
				r.Post("/admin/messages/{id}/status", s.handleAdminSetMessageStatus)
				r.Get("/admin/users", s.handleAdminSearchUsers)
				r.Post("/admin/users/{id}/admin", s.handleAdminSetUserAdmin)
				r.Get("/admin/actions", s.handleAdminListActions)
			})
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
