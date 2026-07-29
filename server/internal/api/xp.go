package api

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// XP awards. A SEPARATE track from reputation: reputation weights
// court-verification voting, so play activity must never buy it (see the
// 00020 migration).
const (
	xpCheckIn        = 10 // geo-verified check-in (same once-per-court-per-20h gate as reputation)
	xpDailyFirst     = 5  // first check-in of the day
	xpShowedUp       = 15 // checked in at a run you said you were going to
	xpHostedRun      = 20 // a run you planned drew at least 2 other players
	xpCourtVerified  = 25 // a court you submitted got verified
	xpFactConfirmed  = 2  // confirmed a court condition (once per court per day)
	xpStreakPerWeek  = 10 // weekly streak bonus, multiplied by the capped streak
	xpStreakMaxWeeks = 5  // streak multiplier stops growing here

	// xpDailyCap bounds a single day's earnings (UTC server day).
	xpDailyCap = 75

	// hostedRunMinAttendees is the going-count earning the hosting award.
	hostedRunMinAttendees = 3
)

// xpTiers maps a minimum level to its tier name. Must stay ascending.
var xpTiers = []struct {
	minLevel int
	name     string
}{
	{1, "Rookie"},
	{5, "Regular"},
	{10, "Starter"},
	{15, "Veteran"},
	{20, "All-Star"},
	{30, "Legend"},
}

// maxLevel bounds the curve so an absurd XP total can't spin levelFor's loop.
const maxLevel = 99

// xpForLevel is the cumulative XP needed to reach level n. Level 1 is 0.
func xpForLevel(n int) int {
	if n <= 1 {
		return 0
	}
	if n > maxLevel {
		n = maxLevel
	}
	return 25 * (n - 1) * n
}

// levelFor is the inverse of xpForLevel. Walks the curve rather than using a
// float sqrt, which rounds wrong exactly at threshold boundaries.
func levelFor(xp int) int {
	if xp <= 0 {
		return 1
	}
	level := 1
	for level < maxLevel && xp >= xpForLevel(level+1) {
		level++
	}
	return level
}

func tierFor(level int) string {
	name := xpTiers[0].name
	for _, t := range xpTiers {
		if level >= t.minLevel {
			name = t.name
		}
	}
	return name
}

// levelProgress describes where a player sits inside their current level.
// XPIntoLevel/XPForNextLevel are relative to the level's floor; at maxLevel
// XPForNextLevel is 0.
type levelProgress struct {
	Level          int    `json:"level"`
	Tier           string `json:"tier"`
	XP             int    `json:"xp"`
	XPIntoLevel    int    `json:"xp_into_level"`
	XPForNextLevel int    `json:"xp_for_next_level"`
}

func progressFor(xp int) levelProgress {
	if xp < 0 {
		xp = 0
	}
	level := levelFor(xp)
	floor := xpForLevel(level)
	next := 0
	if level < maxLevel {
		next = xpForLevel(level+1) - floor
	}
	return levelProgress{
		Level:          level,
		Tier:           tierFor(level),
		XP:             xp,
		XPIntoLevel:    xp - floor,
		XPForNextLevel: next,
	}
}

// awardXP grants points idempotently (dedupKey makes a repeat call a no-op)
// and pushes when the award crosses a level boundary. Returns the points
// actually awarded — 0 when deduped or capped out. Best-effort: never fails
// the request that earned it.
func (s *Server) awardXP(ctx context.Context, userID uuid.UUID, kind, dedupKey string, points int) int {
	row, err := s.store.Queries.AwardXP(ctx, gen.AwardXPParams{
		UserID:   userID,
		Points:   int32(points),
		DailyCap: xpDailyCap,
		Kind:     kind,
		DedupKey: dedupKey,
	})
	if err != nil {
		s.log.Error("award xp", "user", userID, "kind", kind, "err", err)
		return 0
	}
	if row.Awarded == 0 {
		return 0 // deduped, or the daily cap is already spent
	}
	before := levelFor(int(row.TotalXp) - int(row.Awarded))
	after := levelFor(int(row.TotalXp))
	if after > before {
		// Persist the crossing before pushing: most awards land off the
		// request path, so this flag is how the app shows it in-app.
		if err := s.store.Queries.MarkLevelUpPending(ctx, gen.MarkLevelUpPendingParams{
			UserID: userID, Level: int32(after),
		}); err != nil {
			s.log.Error("mark level up pending", "user", userID, "level", after, "err", err)
		}
		s.runBackground("notify level up", func() { s.notifyLevelUp(userID, after) })
	}
	return int(row.Awarded)
}

// awardCheckInXP grants everything a geo-verified check-in can earn. Runs
// off the request path; every award is dedup-keyed, so a retry is a no-op.
// alreadyRecent mirrors the reputation anti-farm gate (same court, 20h).
func (s *Server) awardCheckInXP(userID, courtID, checkInID uuid.UUID, alreadyRecent bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if !alreadyRecent {
		s.awardXP(ctx, userID, "check_in", "checkin:"+checkInID.String(), xpCheckIn)
	}
	// Gating the streak work on the daily-first award keeps the weeks query
	// to once a day.
	if s.awardXP(ctx, userID, "daily_first", "daily:"+utcDay(time.Now()), xpDailyFirst) > 0 {
		s.awardStreakXP(ctx, userID)
	}

	sessionID, err := s.store.Queries.FindAttendedSessionForCheckIn(ctx, gen.FindAttendedSessionForCheckInParams{
		CourtID: courtID, UserID: userID,
	})
	if err != nil {
		return // no matching RSVP'd run (pgx.ErrNoRows) — nothing more to award
	}
	s.awardXP(ctx, userID, "showed_up", "showed:"+sessionID.String(), xpShowedUp)
}

// awardStreakXP grants the weekly streak bonus, scaled by streak length and
// capped. Uses the same UserCheckInWeeks + weekStreak pair as /me/stats, in
// UTC, so the paid streak matches the displayed one.
func (s *Server) awardStreakXP(ctx context.Context, userID uuid.UUID) {
	weeks, err := s.store.Queries.UserCheckInWeeks(ctx, gen.UserCheckInWeeksParams{
		UserID: userID, TzOffsetMinutes: 0,
	})
	if err != nil {
		s.log.Error("streak xp weeks", "user", userID, "err", err)
		return
	}
	starts := make([]time.Time, 0, len(weeks))
	for _, w := range weeks {
		starts = append(starts, w.Time)
	}
	nowWeek := mondayWeekStart(time.Now())
	streak := weekStreak(starts, nowWeek)
	if streak <= 0 {
		return
	}
	if streak > xpStreakMaxWeeks {
		streak = xpStreakMaxWeeks
	}
	s.awardXP(ctx, userID, "streak_week", "streak:"+utcDay(nowWeek), xpStreakPerWeek*streak)
}

// notifyLevelUp tells a player they leveled. Deliberately unconditional on
// the play-nudges toggle, which governs only unprompted nudges.
func (s *Server) notifyLevelUp(userID uuid.UUID, level int) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tokens, err := s.store.Queries.ListUserPushTokens(ctx, userID)
	if err != nil || len(tokens) == 0 {
		if err != nil {
			s.log.Error("level up tokens", "user", userID, "err", err)
		}
		return
	}
	if err := push.Send(ctx, tokens,
		fmt.Sprintf("Level %d — %s", level, tierFor(level)),
		"Your run count is showing. Keep it going.",
		map[string]string{"action": "view_profile"},
	); err != nil {
		s.log.Error("level up push", "user", userID, "err", err)
	}
}

// utcDay is the dedup-key stamp for once-per-day awards.
func utcDay(t time.Time) string { return t.UTC().Format("2006-01-02") }
