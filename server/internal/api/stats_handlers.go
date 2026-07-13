package api

import (
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
type badge struct {
	ID     string `json:"id"`
	Earned bool   `json:"earned"`
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

	writeJSON(w, http.StatusOK, meStatsResponse{
		Games:      int(stats.Games),
		Courts:     int(stats.Courts),
		WeekStreak: streak,
		Badges:     badges,
		HomeCourts: homeCourts,
	})
}
