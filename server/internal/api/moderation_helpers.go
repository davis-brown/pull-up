package api

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
)

// moderationOutageInterval throttles outage reporting: a broken classifier
// fails on every post, so reporting each one would burn Sentry quota.
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

// reportModerationOutage is the only signal that moderation has silently
// stopped working. The message is a fixed string so Sentry
// groups every occurrence into one issue.
func (s *Server) reportModerationOutage(surface string, cause error) {
	if !s.moderationOutage.allow(time.Now(), moderationOutageInterval) {
		return
	}
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		scope.SetTag("subsystem", "text-moderation")
		scope.SetTag("surface", surface)
		scope.SetContext("moderation", sentry.Context{"cause": cause.Error()})
		// Pin the grouping so every outage lands in one Sentry issue.
		scope.SetFingerprint([]string{"text-moderation-unavailable"})
		// No-op unless SENTRY_DSN was set at startup.
		sentry.CaptureMessage("text moderation unavailable — posting is paused")
	})
}

// screenText runs user-submitted text past the content classifier and, when
// it comes back unsafe, writes the rejection and reports false. Used as a
// guard after validation and before any write.
//
// Production fails closed on missing credentials and classifier outages.
// Unconfigured local development and tests may still post. The rejection message
// deliberately does not name the violated category, which would be a
// hill-climbing signal for anyone probing the filter.
func (s *Server) screenText(w http.ResponseWriter, r *http.Request, surface, text string) bool {
	if strings.TrimSpace(text) == "" {
		return true
	}
	if s.cfg != nil && s.cfg.ModerationRequired && userID(r) != uuid.Nil {
		var accepted bool
		if err := s.store.Pool.QueryRow(r.Context(), `SELECT content_consent_version=$2 FROM users WHERE id=$1`, userID(r), contentConsentVersion).Scan(&accepted); err != nil {
			s.internalError(w, "check content consent", err)
			return false
		}
		if !accepted {
			writeError(w, http.StatusForbidden, "Review and accept the updated community terms before posting.")
			return false
		}
	}
	if !s.moderator.Enabled() {
		if s.cfg == nil || !s.cfg.ModerationRequired {
			return true
		}
		s.reportModerationOutage(surface, errors.New("moderation credentials missing"))
		writeError(w, http.StatusServiceUnavailable, "Content checks are temporarily unavailable. Please try again later.")
		return false
	}
	verdict, err := s.moderator.Check(r.Context(), text)
	if err != nil {
		s.log.Error("text moderation unavailable", "surface", surface, "err", err)
		s.reportModerationOutage(surface, err)
		writeError(w, http.StatusServiceUnavailable, "Content checks are temporarily unavailable. Please try again later.")
		return false
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
