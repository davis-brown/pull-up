package api

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// XP awards (phase 20). These are a SEPARATE track from reputation:
// reputation weights court-verification voting, so play activity must
// never buy it — see the 00020 migration for the full reasoning.
//
// "Showed up to a run you RSVP'd to" is deliberately the largest
// per-action award: it's the behavior that makes planned runs
// trustworthy, which is the promise the whole app rests on.
const (
	xpCheckIn        = 10 // geo-verified check-in (same once-per-court-per-20h gate as reputation)
	xpDailyFirst     = 5  // first check-in of the day
	xpShowedUp       = 15 // checked in at a run you said you were going to
	xpHostedRun      = 20 // a run you planned drew at least 2 other players
	xpCourtVerified  = 25 // a court you submitted got verified
	xpFactConfirmed  = 2  // confirmed a court condition (once per court per day)
	xpStreakPerWeek  = 10 // weekly streak bonus, multiplied by the capped streak
	xpStreakMaxWeeks = 5  // streak multiplier stops growing here

	// xpDailyCap bounds a single day's earnings so no amount of grinding
	// runs away with a level. Coarse by design (UTC server day).
	xpDailyCap = 75

	// hostedRunMinAttendees is the going-count at which a planner earns
	// the hosting award: themselves plus two others.
	hostedRunMinAttendees = 3
)

// xpTiers maps a minimum level to its tier name. Ordered ascending;
// tierFor walks it backwards.
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

// maxLevel bounds the curve so a corrupt or absurd XP total can't spin
// levelFor's loop; reaching it takes far more play than any real season.
const maxLevel = 99

// xpForLevel is the cumulative XP needed to reach level n: a quadratic
// curve (25 * (n-1) * n), so the first level lands after a session or two
// of play and later ones take real commitment. Level 1 starts at 0.
func xpForLevel(n int) int {
	if n <= 1 {
		return 0
	}
	if n > maxLevel {
		n = maxLevel
	}
	return 25 * (n - 1) * n
}

// levelFor is the inverse of xpForLevel: the highest level whose
// threshold the given total has reached. Computed by walking the curve
// rather than by inverting it with a float sqrt, which rounds wrong
// exactly at threshold boundaries — the one place users notice.
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

// levelProgress describes where a player sits inside their current level,
// for the app's progress bar. XPIntoLevel/XPForNextLevel are relative to
// the current level's floor so the bar is a simple ratio; at maxLevel
// XPForNextLevel is 0 and the bar reads as full.
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

// awardXP grants points idempotently (dedupKey makes a repeat call a
// no-op) and pushes when the award crosses a level boundary. Returns the
// points actually awarded — 0 when deduped or capped out — so callers can
// skip follow-on work. Best-effort like awardReputation: XP is a soft
// signal, never worth failing the request that earned it.
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
		s.runBackground("notify level up", func() { s.notifyLevelUp(userID, after) })
	}
	return int(row.Awarded)
}

// awardCheckInXP grants everything a geo-verified check-in can earn.
// Runs off the request path (the check-in response shouldn't wait on
// gamification), and every award is dedup-keyed, so a retry is a no-op.
// alreadyRecent mirrors the reputation gate: repeat check-ins at the same
// court inside 20h earn nothing, so a check-in/check-out loop can't farm.
func (s *Server) awardCheckInXP(userID, courtID, checkInID uuid.UUID, alreadyRecent bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if !alreadyRecent {
		s.awardXP(ctx, userID, "check_in", "checkin:"+checkInID.String(), xpCheckIn)
	}
	// The first check-in of the day also settles that week's streak bonus;
	// gating the streak work on it keeps the weeks query to once a day.
	if s.awardXP(ctx, userID, "daily_first", "daily:"+utcDay(time.Now()), xpDailyFirst) > 0 {
		s.awardStreakXP(ctx, userID)
	}

	// Showing up to a run you RSVP'd to: the behavior that makes planned
	// runs worth trusting, and the biggest single award.
	sessionID, err := s.store.Queries.FindAttendedSessionForCheckIn(ctx, gen.FindAttendedSessionForCheckInParams{
		CourtID: courtID, UserID: userID,
	})
	if err != nil {
		return // no matching RSVP'd run (pgx.ErrNoRows) — nothing more to award
	}
	s.awardXP(ctx, userID, "showed_up", "showed:"+sessionID.String(), xpShowedUp)
}

// awardStreakXP grants the weekly streak bonus, scaled by the streak
// length and capped so a long streak can't dwarf every other award.
// Reuses the same UserCheckInWeeks + weekStreak pair that /me/stats uses,
// in UTC, so the streak a player is paid for is the one their profile
// shows.
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

// notifyLevelUp tells a player they leveled. Unconditional on the play-
// nudges toggle: that toggle governs unprompted "come play" nudges, while
// this is a direct response to something they just did.
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
