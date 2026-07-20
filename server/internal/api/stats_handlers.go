package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// Badge thresholds, per the brief. Kept as named constants (rather than
// inlined in deriveBadges) so the response shape's rules are legible in
// one place.
const (
	badgeFirstRunCheckIns  = 1  // first_run: at least one check-in ever.
	badgeExplorerCourts    = 5  // explorer: distinct courts checked into.
	badgeEarlyBirdCheckIns = 5  // early_bird: check-ins with local hour <9.
	badgeRegularCheckIns   = 10 // regular: check-ins at a single court.
	badgeStreak4Weeks      = 4  // streak_4: consecutive weeks with a check-in.
	badgeHostSessions      = 3  // host: sessions created.
)

// badge is one entry in the /me/stats badges array; unearned badges are
// included with earned:false so the client can render a locked state.
// EarnedAt is set once the badge has been observed (phase 21b) and is null
// for unearned badges and for earned ones not yet recorded.
type badge struct {
	ID       string     `json:"id"`
	Earned   bool       `json:"earned"`
	EarnedAt *time.Time `json:"earned_at"`
}

// statsBadgeInputs is the pure-function input to deriveBadges: every
// number a badge rule reads, computed upstream from queries + weekStreak.
type statsBadgeInputs struct {
	Games         int // total check-ins ("first_run").
	Courts        int // distinct courts checked into ("explorer").
	EarlyCount    int // check-ins before local hour 9 ("early_bird").
	MaxAtOneCourt int // check-ins at the user's single most-visited court ("regular").
	WeekStreak    int // consecutive weeks with >=1 check-in ("streak_4").
	SessionsCount int // sessions the user created ("host").
}

// deriveBadges applies the brief's exact thresholds. Order matches the
// brief's example response and is part of the API contract, so badges
// are always returned in this fixed order regardless of earned state.
func deriveBadges(in statsBadgeInputs) []badge {
	return []badge{
		{ID: "first_run", Earned: in.Games >= badgeFirstRunCheckIns},
		{ID: "explorer", Earned: in.Courts >= badgeExplorerCourts},
		{ID: "early_bird", Earned: in.EarlyCount >= badgeEarlyBirdCheckIns},
		{ID: "regular", Earned: in.MaxAtOneCourt >= badgeRegularCheckIns},
		{ID: "streak_4", Earned: in.WeekStreak >= badgeStreak4Weeks},
		{ID: "host", Earned: in.SessionsCount >= badgeHostSessions},
	}
}

// syncBadgeEarnedAt records the earn date of any badge observed for the
// first time and returns the slugs the player hasn't been shown yet. It
// mutates `badges` in place, filling in EarnedAt.
//
// Badges stay derived — this only dates them. The subtlety is the BASELINE:
// every existing player already satisfies several rules, so recording them
// naively would celebrate six badges they won a month ago. The first call
// for a player (badges_synced_at IS NULL) therefore records whatever is
// already earned as ALREADY SEEN and stamps the baseline; only badges
// earned after that are new. A brand-new player's baseline is empty, so
// their genuine first badge still gets its moment.
//
// This is a write on a read path, which is why it is careful to be a no-op
// in the common case: with the baseline taken and no new badge earned,
// there is nothing to insert and it costs one indexed SELECT.
func (s *Server) syncBadgeEarnedAt(ctx context.Context, uid uuid.UUID, badges []badge) ([]string, error) {
	stored, err := s.store.Queries.ListUserBadges(ctx, uid)
	if err != nil {
		return nil, err
	}
	type badgeState struct {
		earnedAt time.Time
		seen     bool
	}
	known := make(map[string]badgeState, len(stored))
	for _, row := range stored {
		known[row.Slug] = badgeState{earnedAt: row.EarnedAt, seen: row.SeenAt != nil}
	}

	syncedAt, err := s.store.Queries.GetBadgesSyncedAt(ctx, uid)
	if err != nil {
		return nil, err
	}
	baseline := syncedAt == nil

	unrecorded := make([]string, 0, len(badges))
	for i := range badges {
		if !badges[i].Earned {
			continue
		}
		if state, ok := known[badges[i].ID]; ok {
			earnedAt := state.earnedAt
			badges[i].EarnedAt = &earnedAt
			continue
		}
		unrecorded = append(unrecorded, badges[i].ID)
	}

	if len(unrecorded) > 0 {
		recorded, err := s.store.Queries.RecordUserBadges(ctx, gen.RecordUserBadgesParams{
			UserID: uid, Slugs: unrecorded, Seen: baseline,
		})
		if err != nil {
			return nil, err
		}
		// Fill in the dates just assigned, so the response that first
		// records a badge reports its earn date rather than null.
		dates := make(map[string]time.Time, len(recorded))
		for _, row := range recorded {
			dates[row.Slug] = row.EarnedAt
		}
		for i := range badges {
			if earnedAt, ok := dates[badges[i].ID]; ok {
				at := earnedAt
				badges[i].EarnedAt = &at
			}
		}
	}
	if baseline {
		if err := s.store.Queries.MarkBadgesSynced(ctx, uid); err != nil {
			return nil, err
		}
		// Everything recorded in the baseline pass counts as already seen.
		return []string{}, nil
	}

	// Unseen = previously recorded but never shown, plus anything just
	// recorded. Ordered by the fixed badge order so the client celebrates
	// them predictably rather than in map order.
	newBadges := make([]string, 0, len(badges))
	for i := range badges {
		if !badges[i].Earned {
			continue
		}
		state, ok := known[badges[i].ID]
		if !ok || !state.seen {
			newBadges = append(newBadges, badges[i].ID)
		}
	}
	return newBadges, nil
}

// handleAckBadges clears the unseen mark on every badge a player has, once
// the app has shown them. Mirrors the level-up ack, and for the same
// reason: /me/stats is refetched in the background, so a read-clears-it
// design would spend the moment on a fetch nobody saw.
func (s *Server) handleAckBadges(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Queries.MarkBadgesSeen(r.Context(), userID(r)); err != nil {
		s.internalError(w, "ack badges", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// mondayWeekStart returns the Monday 00:00 UTC that begins the ISO week
// containing t, matching Postgres's date_trunc('week', …) semantics (used
// by the UserCheckInWeeks query) so Go and SQL agree on which week is
// "current" when deriving the streak.
func mondayWeekStart(t time.Time) time.Time {
	t = t.UTC()
	wd := int(t.Weekday())      // Sunday=0 .. Saturday=6
	sinceMonday := (wd + 6) % 7 // Monday->0, Tuesday->1, …, Sunday->6
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	return d.AddDate(0, 0, -sinceMonday)
}

// weekStreak counts consecutive weeks with at least one check-in, ending
// at nowWeekStart or, if nothing has happened yet this week, at the
// previous week — an active streak isn't broken mid-week just because the
// user hasn't checked in yet today. weekStarts are distinct week-start
// dates (Monday 00:00), e.g. from UserCheckInWeeks; time math (not string
// arithmetic on ISO week labels) keeps this correct across year
// boundaries.
func weekStreak(weekStarts []time.Time, nowWeekStart time.Time) int {
	have := make(map[string]bool, len(weekStarts))
	for _, w := range weekStarts {
		have[w.UTC().Format("2006-01-02")] = true
	}

	cursor := nowWeekStart.UTC()
	if !have[cursor.Format("2006-01-02")] {
		cursor = cursor.AddDate(0, 0, -7)
		if !have[cursor.Format("2006-01-02")] {
			return 0
		}
	}

	streak := 0
	for have[cursor.Format("2006-01-02")] {
		streak++
		cursor = cursor.AddDate(0, 0, -7)
	}
	return streak
}

// homeCourt is one entry in /me/stats' home_courts: a court the user
// frequents, with its live party-size headcount (matching the party-size-
// sum convention used everywhere else, e.g. forecast.sql).
type homeCourt struct {
	CourtID   uuid.UUID `json:"court_id"`
	Name      string    `json:"name"`
	CheckIns  int       `json:"check_ins"`
	LiveCount int       `json:"live_count"`
}

// meStatsResponse is the /me/stats payload: lifetime stats, the week
// streak, all six badges (earned or not), and up to 3 home courts.
type meStatsResponse struct {
	Games      int         `json:"games"`
	Courts     int         `json:"courts"`
	WeekStreak int         `json:"week_streak"`
	Badges     []badge     `json:"badges"`
	HomeCourts []homeCourt `json:"home_courts"`
	// Phase 20: XP and level, flattened in so the player card renders
	// from one request.
	Level          int    `json:"level"`
	Tier           string `json:"tier"`
	XP             int    `json:"xp"`
	XPIntoLevel    int    `json:"xp_into_level"`
	XPForNextLevel int    `json:"xp_for_next_level"`
	// Phase 18: W-L across confirmed games. Shown as a fact on the player
	// card; deliberately not fed into XP or badges, since recording is
	// voluntary and rewarding win RATE would just reward logging wins.
	Wins   int `json:"wins"`
	Losses int `json:"losses"`
	// Phase 21: what the recent XP is made of, and a level crossing the
	// player hasn't been shown yet (null when there is nothing to celebrate).
	XPBreakdown    []xpBreakdownEntry `json:"xp_breakdown"`
	LevelUpPending *int               `json:"level_up_pending"`
	// Phase 21b: badge slugs earned since the last time the app showed
	// them. Empty (never null) so the client can iterate unconditionally.
	NewBadges []string `json:"new_badges"`
}

// xpBreakdownWindowDays bounds the "what have I earned lately" view. Long
// enough that an occasional player still sees themselves in it, short
// enough that it reads as recent rather than lifetime (users.xp already
// carries lifetime).
const xpBreakdownWindowDays = 30

// xpBreakdownEntry is one award kind's contribution over the window. Kind
// is the raw award kind from the ledger ("check_in", "showed_up", …); the
// client owns the display name, so adding an award kind server-side needs
// no client release to stop showing it as unlabelled.
type xpBreakdownEntry struct {
	Kind   string `json:"kind"`
	Points int    `json:"points"`
	Events int    `json:"events"`
}

// handleMeStats serves the profile player card's stats: total games and
// distinct courts, the current week streak, all badges (earned or not),
// and the user's top-3 home courts by check-in count.
func (s *Server) handleMeStats(w http.ResponseWriter, r *http.Request) {
	offsetMinutes, ok := parseTzOffsetMinutes(r.URL.Query().Get("tz_offset_minutes"))
	if !ok {
		writeError(w, http.StatusBadRequest, "tz_offset_minutes must be an integer")
		return
	}

	uid := userID(r)
	ctx := r.Context()

	stats, err := s.store.Queries.UserCheckInStats(ctx, gen.UserCheckInStatsParams{
		TzOffsetMinutes: int32(offsetMinutes),
		UserID:          uid,
	})
	if err != nil {
		s.internalError(w, "user check-in stats", err)
		return
	}

	maxAtOneCourt, err := s.store.Queries.UserMaxCheckInsAtOneCourt(ctx, uid)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.internalError(w, "user max check-ins at one court", err)
			return
		}
		maxAtOneCourt = 0 // no check-ins at all -> GROUP BY yields no rows.
	}

	weekRows, err := s.store.Queries.UserCheckInWeeks(ctx, gen.UserCheckInWeeksParams{
		TzOffsetMinutes: int32(offsetMinutes),
		UserID:          uid,
	})
	if err != nil {
		s.internalError(w, "user check-in weeks", err)
		return
	}
	weekStarts := make([]time.Time, 0, len(weekRows))
	for _, wr := range weekRows {
		if wr.Valid {
			weekStarts = append(weekStarts, wr.Time)
		}
	}
	nowWeekStart := mondayWeekStart(time.Now().UTC().Add(time.Duration(offsetMinutes) * time.Minute))
	streak := weekStreak(weekStarts, nowWeekStart)

	sessionsCount, err := s.store.Queries.UserSessionCount(ctx, uid)
	if err != nil {
		s.internalError(w, "user session count", err)
		return
	}

	badges := deriveBadges(statsBadgeInputs{
		Games:         int(stats.Games),
		Courts:        int(stats.Courts),
		EarlyCount:    int(stats.Early),
		MaxAtOneCourt: int(maxAtOneCourt),
		WeekStreak:    streak,
		SessionsCount: int(sessionsCount),
	})

	newBadges, err := s.syncBadgeEarnedAt(ctx, uid, badges)
	if err != nil {
		s.internalError(w, "sync badge earned-at", err)
		return
	}

	homeCourtRows, err := s.store.Queries.UserHomeCourts(ctx, uid)
	if err != nil {
		s.internalError(w, "user home courts", err)
		return
	}
	homeCourts := make([]homeCourt, 0, len(homeCourtRows))
	for _, hc := range homeCourtRows {
		homeCourts = append(homeCourts, homeCourt{
			CourtID:   hc.CourtID,
			Name:      hc.Name,
			CheckIns:  int(hc.CheckIns),
			LiveCount: int(hc.LiveCount),
		})
	}

	record, err := s.store.Queries.UserGameRecord(ctx, uid)
	if err != nil {
		s.internalError(w, "user game record", err)
		return
	}

	xpState, err := s.store.Queries.GetUserXP(ctx, uid)
	if err != nil {
		s.internalError(w, "user xp", err)
		return
	}
	progress := progressFor(int(xpState.Xp))

	breakdownRows, err := s.store.Queries.XPBreakdownSince(ctx, gen.XPBreakdownSinceParams{
		UserID: uid,
		Since:  time.Now().AddDate(0, 0, -xpBreakdownWindowDays),
	})
	if err != nil {
		s.internalError(w, "xp breakdown", err)
		return
	}
	breakdown := make([]xpBreakdownEntry, 0, len(breakdownRows))
	for _, b := range breakdownRows {
		breakdown = append(breakdown, xpBreakdownEntry{
			Kind: b.Kind, Points: int(b.Points), Events: int(b.Events),
		})
	}

	var levelUpPending *int
	if xpState.LevelUpPending != nil {
		level := int(*xpState.LevelUpPending)
		levelUpPending = &level
	}

	writeJSON(w, http.StatusOK, meStatsResponse{
		Games:          int(stats.Games),
		Courts:         int(stats.Courts),
		WeekStreak:     streak,
		Badges:         badges,
		HomeCourts:     homeCourts,
		Level:          progress.Level,
		Tier:           progress.Tier,
		XP:             progress.XP,
		XPIntoLevel:    progress.XPIntoLevel,
		XPForNextLevel: progress.XPForNextLevel,
		Wins:           int(record.Wins),
		Losses:         int(record.Losses),
		XPBreakdown:    breakdown,
		LevelUpPending: levelUpPending,
		NewBadges:      newBadges,
	})
}

// handleAckLevelUp clears a pending level crossing once the app has shown
// it. Explicit rather than clearing inside /me/stats: the app refetches
// stats on resume and in the background, so a read-clears-it design would
// routinely spend the celebration on a fetch the player never saw.
// Idempotent — acking nothing is a no-op, so a retry is safe.
func (s *Server) handleAckLevelUp(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Queries.AckLevelUp(r.Context(), userID(r)); err != nil {
		s.internalError(w, "ack level up", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
