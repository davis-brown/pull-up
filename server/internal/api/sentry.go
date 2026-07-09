package api

import (
	"fmt"
	"net/http"

	"github.com/getsentry/sentry-go"
	"github.com/go-chi/chi/v5/middleware"
)

// sentryReporter captures panics (then re-panics so Recoverer still returns
// a 500) and reports 5xx responses. All sentry-go calls are no-ops unless
// sentry.Init ran at startup (SENTRY_DSN set), so this is always safe to
// register.
func sentryReporter(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			if rec := recover(); rec != nil {
				hub := sentry.CurrentHub().Clone()
				hub.Recover(rec)
				panic(rec)
			}
			if ww.Status() >= http.StatusInternalServerError {
				sentry.CaptureMessage(fmt.Sprintf(
					"%d on %s %s", ww.Status(), r.Method, r.URL.Path))
			}
		}()
		next.ServeHTTP(ww, r)
	})
}
