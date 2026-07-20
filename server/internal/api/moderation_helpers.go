package api

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
)

// moderationOutageInterval throttles outage reporting. A broken classifier
// fails on EVERY post, so reporting each one would burn Sentry quota to say
// one thing. Sentry would group them into a single issue anyway; this keeps
// the event count sane while still firing promptly.
const moderationOutageInterval = 5 * time.Minute

// outageThrottle rate-limits a repeated alert. The zero value is ready to
// use and reports the first occurrence immediately.
type outageThrottle struct {
	mu   sync.Mutex
	last time.Time
}

func (t *outageThrottle) allow(now time.Time, every time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.last.IsZero() && now.Sub(t.last) < every {
		return false
	}
	t.last = now
	return true
}

// reportModerationOutage raises the failure where it can actually page
// someone. This is the only signal that moderation has silently stopped
// working: screenText fails open, so a bad token or an expired one looks
// exactly like normal operation from the app's side.
//
// The message is a fixed string so Sentry groups every occurrence into one
// issue; the varying detail goes in the scope, where it does not fragment
// the grouping.
func (s *Server) reportModerationOutage(surface string, cause error) {
	if !s.moderationOutage.allow(time.Now(), moderationOutageInterval) {
		return
	}
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		scope.SetTag("subsystem", "text-moderation")
		scope.SetTag("surface", surface)
		scope.SetContext("moderation", sentry.Context{"cause": cause.Error()})
		// Pin the grouping so every outage lands in ONE Sentry issue whatever
		// the underlying cause reads like. An alert rule can then watch a
		// single issue instead of a family that keeps sprouting new members.
		scope.SetFingerprint([]string{"text-moderation-unavailable"})
		// No-op unless SENTRY_DSN was set at startup.
		sentry.CaptureMessage("text moderation unavailable — posts are going unscreened")
	})
}

// screenText runs user-submitted text past the content classifier and, when
// it comes back unsafe, writes the rejection and reports false.
//
// Callers use it as a guard right after validation and before any write:
//
//	if !s.screenText(w, r, "court message", body) {
//	    return
//	}
//
// Moderation is best-effort by design. A classifier outage returns a safe
// verdict plus an error (see moderation.Check); this logs that and lets the
// post through, because taking chat down when Workers AI has a bad minute
// is a worse failure for a solo-run app than briefly missing a message. It
// is also a no-op when Workers AI credentials are unset, which is how local
// development and CI run.
//
// The rejection message deliberately does not name the violated category.
// Telling someone exactly which rule they tripped is a hill-climbing signal
// for anyone probing the filter.
func (s *Server) screenText(w http.ResponseWriter, r *http.Request, surface, text string) bool {
	if strings.TrimSpace(text) == "" || !s.moderator.Enabled() {
		return true
	}
	verdict, err := s.moderator.Check(r.Context(), text)
	if err != nil {
		s.log.Error("text moderation unavailable", "surface", surface, "err", err)
		s.reportModerationOutage(surface, err)
		return true
	}
	if !verdict.Safe {
		s.log.Info("text moderation blocked a post",
			"surface", surface, "user", userID(r), "categories", verdict.Categories)
		writeError(w, http.StatusUnprocessableEntity,
			"that message looks like it breaks the community rules — try rewording it")
		return false
	}
	return true
}
