package api

import (
	"net/http"
	"time"

	"github.com/go-chi/httprate"
)

// rateLimitKey buckets requests by client IP. Behind Cloudflare the real
// client arrives in CF-Connecting-IP (set by the edge, not spoofable
// through it); elsewhere fall back to httprate's RemoteAddr keying.
func rateLimitKey(r *http.Request) (string, error) {
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip, nil
	}
	return httprate.KeyByIP(r)
}

func perIPLimit(requestLimit int, window time.Duration) func(http.Handler) http.Handler {
	return httprate.Limit(requestLimit, window,
		httprate.WithKeyFuncs(rateLimitKey),
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			// httprate sets Retry-After before invoking this; belt and
			// braces for older versions.
			if w.Header().Get("Retry-After") == "" {
				w.Header().Set("Retry-After", "60")
			}
			writeError(w, http.StatusTooManyRequests, "too many requests — slow down")
		}),
	)
}

// writeLimiter rate-limits mutating methods only; reads stay unlimited
// (map browsing fans out many GETs per pan).
func writeLimiter(requestLimit int, window time.Duration) func(http.Handler) http.Handler {
	limit := perIPLimit(requestLimit, window)
	return func(next http.Handler) http.Handler {
		limited := limit(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
			default:
				limited.ServeHTTP(w, r)
			}
		})
	}
}
