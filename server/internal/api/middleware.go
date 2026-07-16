package api

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
)

type ctxKey int

const userIDKey ctxKey = iota

func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		header := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || token == "" {
			writeError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		userID, err := s.issuer.VerifyAccessToken(token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey, userID)))
	})
}

func authCachePolicy(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Authorization")
		w.Header().Add("Vary", "Cookie")
		w.Header().Add("Vary", "X-Pull-Up-Platform")
		if r.Header.Get("Authorization") != "" ||
			strings.HasPrefix(r.URL.Path, "/api/v1/auth/") ||
			strings.HasPrefix(r.URL.Path, "/api/v1/internal/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) internalSecretValid(r *http.Request) bool {
	provided := r.Header.Get("X-Internal-Task")
	return s.cfg.InternalTaskSecret != "" &&
		subtle.ConstantTimeCompare([]byte(provided), []byte(s.cfg.InternalTaskSecret)) == 1
}

func (s *Server) requireInternalSecret(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !s.internalSecretValid(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requireWebAuthOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isWebClient(r) && !sameOriginRequest(r) && !s.allowedWebOrigin(r.Header.Get("Origin")) {
			writeError(w, http.StatusForbidden, "invalid web origin")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) allowedWebOrigin(origin string) bool {
	for _, allowed := range s.cfg.CORSOrigins {
		if strings.TrimSpace(allowed) == origin {
			return true
		}
	}
	return false
}

func sameOriginRequest(r *http.Request) bool {
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.Scheme == "" || origin.Host == "" || origin.User != nil {
		return false
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return subtle.ConstantTimeCompare([]byte(origin.Scheme), []byte(scheme)) == 1 &&
		subtle.ConstantTimeCompare([]byte(origin.Host), []byte(host)) == 1
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = r.URL.Path
		}
		s.log.Info("http request",
			"method", r.Method,
			"route", route,
			"status", ww.Status(),
			"duration_ms", time.Since(started).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}

func userID(r *http.Request) uuid.UUID {
	id, _ := r.Context().Value(userIDKey).(uuid.UUID)
	return id
}
