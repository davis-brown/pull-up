package api

import (
	"context"
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
	"github.com/davisbrown/pull-up/server/internal/moderation"
	"github.com/davisbrown/pull-up/server/internal/seeder"
	"github.com/davisbrown/pull-up/server/internal/store"
)

type Server struct {
	cfg             *config.Config
	store           *store.Store
	issuer          *auth.Issuer
	oauth           *auth.OAuthVerifier
	log             *slog.Logger
	seeder          *seeder.Seeder     // nil when auto-seeding is disabled
	enricher        *enrich.Enricher   // nil when enrichment is disabled
	moderator       *moderation.Client // disabled without Workers AI credentials
	backgroundSlots chan struct{}
}

func NewServer(cfg *config.Config, st *store.Store, log *slog.Logger, sd *seeder.Seeder, en *enrich.Enricher) *Server {
	return &Server{
		cfg:             cfg,
		store:           st,
		issuer:          auth.NewIssuer(cfg.JWTSecret, cfg.AccessTokenTTL),
		oauth:           auth.NewOAuthVerifier(cfg.GoogleClientIDs, cfg.AppleAudiences),
		log:             log,
		seeder:          sd,
		enricher:        en,
		moderator:       moderation.New(cfg.CloudflareAccountID, cfg.CloudflareAIToken),
		backgroundSlots: make(chan struct{}, 32),
	}
}

// requestSeeding durably queues background OSM imports for never-seeded tiles
// in the viewport. No-op when auto-seeding is off.
func (s *Server) requestSeeding(ctx context.Context, minLng, minLat, maxLng, maxLat float64) {
	if s.seeder != nil {
		s.seeder.Request(ctx, minLng, minLat, maxLng, maxLat)
	}
}

// runBackground bounds best-effort notification work. Requests are never
// allowed to create an unbounded number of goroutines under load.
func (s *Server) runBackground(name string, fn func()) {
	select {
	case s.backgroundSlots <- struct{}{}:
		go func() {
			defer func() { <-s.backgroundSlots }()
			fn()
		}()
	default:
		s.log.Warn("background work dropped", "task", name)
	}
}

// viewportSeeding reports whether the viewport still has tiles importing.
func (s *Server) viewportSeeding(ctx context.Context, minLng, minLat, maxLng, maxLat float64) bool {
	if s.seeder == nil {
		return false
	}
	return s.seeder.ViewportSeeding(ctx, minLng, minLat, maxLng, maxLat)
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	if s.cfg.TrustCloudflareHeaders {
		r.Use(middleware.RealIP)
	}
	r.Use(s.requestLogger)
	r.Use(middleware.Recoverer)
	r.Use(sentryReporter)
	r.Use(securityHeaders)
	r.Use(authCachePolicy)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   s.cfg.CORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Pull-Up-Platform"},
		AllowCredentials: true,
		MaxAge:           600,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(limitBody)
		r.Group(func(r chi.Router) {
			r.Use(s.requireWebAuthOrigin)
			// Brute-force guard: covers register, login, refresh, logout, oauth.
			if s.cfg.RateLimitAuthPerMin > 0 {
				r.Use(perIPLimit(s.cfg.RateLimitAuthPerMin, time.Minute, s.cfg.TrustCloudflareHeaders))
			}
			r.Post("/auth/register", s.handleRegister)
			r.Post("/auth/login", s.handleLogin)
			r.Post("/auth/refresh", s.handleRefresh)
			r.Post("/auth/logout", s.handleLogout)
			r.Post("/auth/oauth", s.handleOAuth)
			r.Post("/auth/email-verification/request", s.handleRequestEmailVerification)
			r.Post("/auth/email-verification/verify", s.handleVerifyEmail)
		})

		// Secret-guarded Worker/scheduler integration endpoints.
		r.Route("/internal", func(r chi.Router) {
			r.Use(s.requireInternalSecret)
			r.Get("/version", s.handleInternalVersion)
			r.Post("/drain", s.handleInternalDrain)
			r.Post("/media/authorize", s.handleInternalAuthorizeMedia)
			r.Post("/media/uploaded", s.handleInternalMediaUploaded)
			r.Post("/media/deletions/claim", s.handleInternalClaimObjectDeletions)
			r.Post("/media/deletions/ack", s.handleInternalAckObjectDeletions)
		})

		r.Get("/courts/forecast", s.handleForecast) // must precede /courts/{id} or chi routes "forecast" as an id
		r.Group(func(r chi.Router) {
			if s.cfg.RateLimitDiscoveryPerMin > 0 {
				r.Use(perIPLimit(s.cfg.RateLimitDiscoveryPerMin, time.Minute, s.cfg.TrustCloudflareHeaders))
			}
			r.Get("/courts", s.handleListCourts)
			r.Post("/courts/search", s.handleSearchCourts)
			r.Get("/courts/{id}", s.handleGetCourt)
			r.Get("/courts/{id}/facts", s.handleListCourtFacts)
		})
		r.Get("/courts/{id}/activity", s.handleCourtActivity)
		r.Get("/courts/{id}/photos", s.handleListPhotos)
		r.Get("/courts/{id}/sessions", s.handleListSessions)      // personalizes via optional bearer
		r.Get("/courts/{id}/run-intents", s.handleListRunIntents) // public: who wants to run where
		r.Get("/courts/{id}/messages", s.handleListMessages)
		r.Get("/courts/{id}/games", s.handleListCourtGames) // confirmed results only
		r.Get("/sessions/nearby", s.handleNearbyRuns)       // static must precede /sessions/{id}; personalizes via optional bearer
		r.Get("/sessions/{id}/attendees", s.handleSessionAttendees)
		r.Get("/users/{id}", s.handleGetProfile) // public profile; personalizes via optional bearer
		r.Get("/users/{id}/followers", s.handleListFollowers)
		r.Get("/users/{id}/following", s.handleListFollowing)

		// Authenticated routes.
		r.Group(func(r chi.Router) {
			r.Use(s.requireAuth)
			if s.cfg.RateLimitWritePerMin > 0 {
				r.Use(writeLimiter(s.cfg.RateLimitWritePerMin, time.Minute, s.cfg.TrustCloudflareHeaders))
			}

			r.Get("/me", s.handleGetMe)
			r.Patch("/me", s.handlePatchMe)
			r.Delete("/me", s.handleDeleteMe)
			r.Post("/me/avatar", s.handleCreateAvatarUpload)
			r.Delete("/me/avatar", s.handleDeleteAvatar)
			r.Get("/me/blocked", s.handleListBlocked)
			r.Put("/users/{id}/block", s.handleBlockUser)
			r.Delete("/users/{id}/block", s.handleUnblockUser)
			r.Put("/users/{id}/follow", s.handleFollow)
			r.Delete("/users/{id}/follow", s.handleUnfollow)
			r.Get("/me/follow-requests", s.handleListFollowRequests)
			r.Post("/users/{id}/follow-requests/accept", s.handleAcceptFollowRequest)
			r.Post("/users/{id}/follow-requests/reject", s.handleRejectFollowRequest)
			r.Get("/me/check-ins/current", s.handleCurrentCheckIn)
			r.Get("/me/check-ins", s.handleCheckInHistory)
			r.Get("/me/stats", s.handleMeStats)
			r.Post("/me/level-up/ack", s.handleAckLevelUp)
			r.Post("/me/badges/ack", s.handleAckBadges)
			// Leaderboards are authenticated: they name players, and the
			// visibility rules they enforce are all relative to a viewer.
			r.Get("/courts/{id}/leaderboard", s.handleCourtLeaderboard)
			r.Get("/me/circle/leaderboard", s.handleCircleLeaderboard)
			r.Get("/me/favorites", s.handleListFavorites)
			r.Post("/me/push-token", s.handleRegisterPushToken)
			r.Delete("/me/push-token", s.handleUnregisterPushToken)
			r.Get("/feed", s.handleGetFeed)

			r.Post("/courts", s.handleCreateCourt)
			r.Patch("/courts/{id}/attributes", s.handlePatchCourtAttributes)
			r.Post("/courts/{id}/facts", s.handleConfirmCourtFact)
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
			r.Put("/courts/{id}/run-intents", s.handleSetRunIntent)
			r.Delete("/courts/{id}/run-intents", s.handleWithdrawRunIntent)
			r.Post("/courts/{id}/games", s.handleRecordGame)
			r.Post("/games/{id}/confirm", s.handleConfirmGame)
			r.Get("/me/games/pending", s.handleListPendingGames)
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
				r.Post("/admin/users/{id}/avatar/clear", s.handleAdminClearAvatar)
				r.Get("/admin/actions", s.handleAdminListActions)
			})
		})
	})

	return r
}

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
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBody)
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
