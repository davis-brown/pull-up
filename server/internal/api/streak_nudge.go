package api

import (
	"context"
	"fmt"
	"time"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// The streak nudge is the app's only unprompted "come play" notification. It
// fires only on a streak the player built themselves, and only inside a
// window where acting on it is still possible.
const (
	// nudgeMaxCandidatesPerRun bounds one cron tick's work. The
	// Thursday-Saturday evening window is applied in ListStreakNudgeCandidates.
	nudgeMaxCandidatesPerRun = 200
)

// streakNudgeBody renders the copy for a streak of n weeks.
func streakNudgeBody(streak int, daysLeft int) string {
	unit := "days"
	if daysLeft == 1 {
		unit = "day"
	}
	return fmt.Sprintf("Your %d-week streak needs a run — %d %s left.", streak, daysLeft, unit)
}

// daysLeftInStreakWeek counts whole days from localNow to the end of its
// Monday-start week (Sunday inclusive), so Saturday evening reads "1 day
// left" rather than "0".
func daysLeftInStreakWeek(localNow time.Time) int {
	// Monday=0 … Sunday=6.
	idx := (int(localNow.Weekday()) + 6) % 7
	return 6 - idx + 1
}

// runStreakNudges is the cron pass: find players whose streak is alive but
// unplayed this week, and nudge the ones for whom it is currently evening.
// Called from the internal drain endpoint on the hourly Cloudflare cron; the
// 17:00-21:00 local window gives every candidate several ticks.
func (s *Server) runStreakNudges(ctx context.Context) int {
	now := time.Now()
	candidates, err := s.store.Queries.ListStreakNudgeCandidates(ctx, gen.ListStreakNudgeCandidatesParams{
		Now: now, MaxCandidates: nudgeMaxCandidatesPerRun,
	})
	if err != nil {
		s.log.Error("streak nudge candidates", "err", err)
		return 0
	}
	sent := 0
	for _, c := range candidates {
		if c.Timezone == nil {
			continue
		}
		loc, err := time.LoadLocation(*c.Timezone)
		if err != nil {
			continue // an unusable stored zone silently opts them out
		}
		localNow := now.In(loc)

		// Same helper /me/stats uses, so the push matches the profile.
		weeks, err := s.store.Queries.UserCheckInWeeks(ctx, gen.UserCheckInWeeksParams{
			UserID: c.UserID, TzOffsetMinutes: 0,
		})
		if err != nil {
			s.log.Error("streak nudge weeks", "user", c.UserID, "err", err)
			continue
		}
		starts := make([]time.Time, 0, len(weeks))
		for _, w := range weeks {
			if w.Valid {
				starts = append(starts, w.Time)
			}
		}
		streak := weekStreak(starts, mondayWeekStart(now))
		if streak <= 0 {
			continue // the streak died after all; say nothing
		}

		tokens, err := s.store.Queries.ListUserPushTokens(ctx, c.UserID)
		if err != nil || len(tokens) == 0 {
			continue
		}
		// Mark before sending: a failed push must not retry into a
		// double-notify.
		if err := s.store.Queries.MarkPlayNudgeSent(ctx, c.UserID); err != nil {
			s.log.Error("mark play nudge sent", "user", c.UserID, "err", err)
			continue
		}
		if err := s.sendPush(ctx, tokens,
			"Keep your streak alive",
			streakNudgeBody(streak, daysLeftInStreakWeek(localNow)),
			map[string]string{"action": "view_map"},
		); err != nil {
			s.log.Error("streak nudge push", "user", c.UserID, "err", err)
			continue
		}
		sent++
	}
	return sent
}
