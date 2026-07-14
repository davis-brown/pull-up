package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/config"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// -- parseForecastIDs ---------------------------------------------------

func TestParseForecastIDs(t *testing.T) {
	a := uuid.New()
	b := uuid.New()

	if _, ok := parseForecastIDs(""); ok {
		t.Error("empty ids should be rejected")
	}
	if _, ok := parseForecastIDs("   "); ok {
		t.Error("blank ids should be rejected")
	}
	if _, ok := parseForecastIDs("not-a-uuid"); ok {
		t.Error("invalid uuid should be rejected")
	}
	if _, ok := parseForecastIDs(a.String() + ",not-a-uuid"); ok {
		t.Error("any invalid uuid in the list should reject the whole request")
	}

	// Exactly 50 is fine; 51 is not.
	fifty := make([]string, 50)
	for i := range fifty {
		fifty[i] = uuid.New().String()
	}
	if _, ok := parseForecastIDs(strings.Join(fifty, ",")); !ok {
		t.Error("50 ids should be accepted")
	}
	fiftyOne := append(fifty, uuid.New().String())
	if _, ok := parseForecastIDs(strings.Join(fiftyOne, ",")); ok {
		t.Error("51 ids should be rejected")
	}

	ids, ok := parseForecastIDs(a.String() + "," + b.String())
	if !ok {
		t.Fatalf("valid csv should be accepted")
	}
	if len(ids) != 2 || ids[0] != a || ids[1] != b {
		t.Errorf("parseForecastIDs order = %v, want [%s %s]", ids, a, b)
	}

	// Duplicates are dropped, keeping first-occurrence order.
	dedup, ok := parseForecastIDs(a.String() + "," + b.String() + "," + a.String())
	if !ok {
		t.Fatalf("csv with duplicates should be accepted")
	}
	if len(dedup) != 2 || dedup[0] != a || dedup[1] != b {
		t.Errorf("parseForecastIDs dedup = %v, want [%s %s]", dedup, a, b)
	}
}

// -- parseTzOffsetMinutes ------------------------------------------------

func TestParseTzOffsetMinutes(t *testing.T) {
	if v, ok := parseTzOffsetMinutes(""); !ok || v != 0 {
		t.Errorf("absent offset = (%d, %v), want (0, true)", v, ok)
	}
	if v, ok := parseTzOffsetMinutes("-300"); !ok || v != -300 {
		t.Errorf("-300 = (%d, %v), want (-300, true)", v, ok)
	}
	if v, ok := parseTzOffsetMinutes("10000"); !ok || v != 840 {
		t.Errorf("over-range positive should clamp to 840, got (%d, %v)", v, ok)
	}
	if v, ok := parseTzOffsetMinutes("-10000"); !ok || v != -840 {
		t.Errorf("over-range negative should clamp to -840, got (%d, %v)", v, ok)
	}
	if _, ok := parseTzOffsetMinutes("banana"); ok {
		t.Error("non-numeric offset should be rejected")
	}
}

// -- forecastDayBounds / localHour ---------------------------------------

func TestForecastDayBounds(t *testing.T) {
	// 2026-07-12T02:00:00Z with offset -300 (UTC-5) is 2026-07-11T21:00 local
	// (a Saturday, DOW=6). Local midnight->midnight is
	// 2026-07-11T05:00Z .. 2026-07-12T05:00Z.
	now := time.Date(2026, 7, 12, 2, 0, 0, 0, time.UTC)
	dow, start, end := forecastDayBounds(now, -300)
	if dow != 6 {
		t.Errorf("dow = %d, want 6 (Saturday)", dow)
	}
	wantStart := time.Date(2026, 7, 11, 5, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, 7, 12, 5, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) {
		t.Errorf("dayStart = %v, want %v", start, wantStart)
	}
	if !end.Equal(wantEnd) {
		t.Errorf("dayEnd = %v, want %v", end, wantEnd)
	}
	if end.Sub(start) != 24*time.Hour {
		t.Errorf("day span = %v, want 24h", end.Sub(start))
	}
}

func TestLocalHour(t *testing.T) {
	// 18:30 UTC shifted by -300 minutes (UTC-5) is 13:30 local.
	ts := time.Date(2026, 7, 12, 18, 30, 0, 0, time.UTC)
	if h := localHour(ts, -300); h != 13 {
		t.Errorf("localHour = %d, want 13", h)
	}
	// Positive offset crossing midnight: 23:00 UTC + 120min = 01:00 next day.
	ts2 := time.Date(2026, 7, 12, 23, 0, 0, 0, time.UTC)
	if h := localHour(ts2, 120); h != 1 {
		t.Errorf("localHour across midnight = %d, want 1", h)
	}
}

// -- averageHeads ----------------------------------------------------------

func TestAverageHeads(t *testing.T) {
	// The brief's example: total 24 over 8 weeks -> 3 (unchanged behavior).
	if got := averageHeads(24, 8); got != 3 {
		t.Errorf("averageHeads(24, 8) = %d, want 3", got)
	}
	// A court with only 3 weeks of history divides by 3, not 8.
	if got := averageHeads(24, 3); got != 8 {
		t.Errorf("averageHeads(24, 3) = %d, want 8", got)
	}
	// Rounding, not truncation: 20/8 = 2.5 -> rounds to 3 (round-half-away-from-zero).
	if got := averageHeads(20, 8); got != 3 {
		t.Errorf("averageHeads(20, 8) = %d, want 3 (rounded, not truncated)", got)
	}
	// 19/8 = 2.375 -> rounds down to 2.
	if got := averageHeads(19, 8); got != 2 {
		t.Errorf("averageHeads(19, 8) = %d, want 2", got)
	}
	if got := averageHeads(0, 8); got != 0 {
		t.Errorf("averageHeads(0, 8) = %d, want 0", got)
	}
	// weeks is clamped to a floor of 1, so 0 (or bogus negative) history
	// weeks can't divide by zero or inflate the average unboundedly.
	if got := averageHeads(5, 0); got != 5 {
		t.Errorf("averageHeads(5, 0) = %d, want 5 (weeks clamped to 1)", got)
	}
	// weeks is clamped to a ceiling of forecastWeeks (8) — more distinct
	// weeks than the trailing window can supply doesn't over-divide.
	if got := averageHeads(80, 20); got != 10 {
		t.Errorf("averageHeads(80, 20) = %d, want 10 (weeks clamped to 8)", got)
	}
}

// -- buildForecasts (the pure assembly logic; no DB needed) ---------------
//
// These tests exercise Go assembly from fake gen.CourtHourlyCheckInHistoryRow
// rows and are agnostic to how the store computed TotalHeads per bucket.
// CourtHourlyCheckInHistory (forecast.sql) buckets a check-in's ENTIRE active
// window [created_at, coalesce(checked_out_at, expires_at)) into every local
// hour it overlaps (an average concurrent headcount), not just its start
// hour — see TestCourtHourlyCheckInHistoryOverlapsBuckets in
// internal/store/store_integration_test.go for the DB-backed overlap case.
// The row contract consumed here (court_id, local_hour, total_heads) is
// unchanged by that bucketing, so these fakes remain valid regardless.

func TestBuildForecastsAssemblesInIDsOrderWithHistoryAndSessions(t *testing.T) {
	courtA := uuid.New()
	courtB := uuid.New() // no history, no sessions
	sessionID := uuid.New()

	// Fake rows, standing in for what the store would return: court A has
	// 24 heads total in bucket hour 18 over the trailing 8 weeks -> 3.
	history := []gen.CourtHourlyCheckInHistoryRow{
		{CourtID: courtA, LocalHour: 18, TotalHeads: 24},
	}
	// Court A has a full 8 weeks of history -> divisor unchanged at 8.
	weeks := []gen.CourtHistoryWeeksRow{
		{CourtID: courtA, WeekCount: 8},
	}
	// Session starts at a UTC instant that's 19:00 local once shifted by the
	// offset (UTC-5): localHour(startsAt, offsetMinutes) must equal 19.
	offsetMinutes := -300 // UTC-5
	startsAt := time.Date(2026, 7, 12, 19, 0, 0, 0, time.UTC).Add(-time.Duration(offsetMinutes) * time.Minute)
	sessions := []gen.CourtSessionsForDayRow{
		{ID: sessionID, CourtID: courtA, StartsAt: startsAt, Going: 7},
	}

	ids := []uuid.UUID{courtA, courtB}
	got := buildForecasts(ids, history, weeks, sessions, offsetMinutes)

	if len(got) != 2 {
		t.Fatalf("len(forecasts) = %d, want 2", len(got))
	}

	// ids order preserved.
	if got[0].CourtID != courtA || got[1].CourtID != courtB {
		t.Fatalf("forecasts not in ids order: %+v", got)
	}

	fa := got[0]
	if !fa.HasHistory {
		t.Error("court A should have has_history:true")
	}
	if fa.Hours[18] != 3 {
		t.Errorf("court A hours[18] = %d, want 3", fa.Hours[18])
	}
	for h, v := range fa.Hours {
		if h == 18 {
			continue
		}
		if v != 0 {
			t.Errorf("court A hours[%d] = %d, want 0", h, v)
		}
	}
	if len(fa.Sessions) != 1 {
		t.Fatalf("court A sessions = %+v, want 1 entry", fa.Sessions)
	}
	if fa.Sessions[0].SessionID != sessionID || fa.Sessions[0].Hour != 19 || fa.Sessions[0].Going != 7 {
		t.Errorf("court A session = %+v, want {id:%s hour:19 going:7}", fa.Sessions[0], sessionID)
	}

	// Court B: no history rows at all -> has_history false, all-zero hours,
	// empty (not nil) sessions.
	fb := got[1]
	if fb.HasHistory {
		t.Error("court B should have has_history:false")
	}
	for h, v := range fb.Hours {
		if v != 0 {
			t.Errorf("court B hours[%d] = %d, want 0", h, v)
		}
	}
	if fb.Sessions == nil || len(fb.Sessions) != 0 {
		t.Errorf("court B sessions = %+v, want empty slice", fb.Sessions)
	}
}

func TestBuildForecastsIgnoresRowsForUnrequestedCourts(t *testing.T) {
	requested := uuid.New()
	other := uuid.New()
	history := []gen.CourtHourlyCheckInHistoryRow{
		{CourtID: other, LocalHour: 10, TotalHeads: 8},
	}
	got := buildForecasts([]uuid.UUID{requested}, history, nil, nil, 0)
	if len(got) != 1 {
		t.Fatalf("len(forecasts) = %d, want 1", len(got))
	}
	if got[0].HasHistory {
		t.Error("row for a court not in ids must not be attributed to the requested court")
	}
}

// TestBuildForecastsDividesByActualWeekCount is the regression case for the
// "reads at ~3/8 of its true average" bug: a court with only 3 weeks of
// check-in history must divide by 3, not a flat 8.
func TestBuildForecastsDividesByActualWeekCount(t *testing.T) {
	court := uuid.New()
	history := []gen.CourtHourlyCheckInHistoryRow{
		{CourtID: court, LocalHour: 18, TotalHeads: 24},
	}
	weeks := []gen.CourtHistoryWeeksRow{
		{CourtID: court, WeekCount: 3},
	}
	got := buildForecasts([]uuid.UUID{court}, history, weeks, nil, 0)
	if len(got) != 1 {
		t.Fatalf("len(forecasts) = %d, want 1", len(got))
	}
	if !got[0].HasHistory {
		t.Error("has_history should be true")
	}
	if got[0].Hours[18] != 8 {
		t.Errorf("hours[18] = %d, want 8 (24 total / 3 weeks of history)", got[0].Hours[18])
	}
}

// TestBuildForecastsNoHistoryRowsZerosOut covers the 0-rows case: a court
// with no matching history rows at all gets has_history:false and every
// hour zero, regardless of what CourtHistoryWeeks might separately report.
func TestBuildForecastsNoHistoryRowsZerosOut(t *testing.T) {
	court := uuid.New()
	got := buildForecasts([]uuid.UUID{court}, nil, nil, nil, 0)
	if len(got) != 1 {
		t.Fatalf("len(forecasts) = %d, want 1", len(got))
	}
	if got[0].HasHistory {
		t.Error("has_history should be false with zero history rows")
	}
	for h, v := range got[0].Hours {
		if v != 0 {
			t.Errorf("hours[%d] = %d, want 0", h, v)
		}
	}
}

// -- handler-level validation (no DB touched on these paths) --------------

// newBareServer builds a Server with a nil store: safe for exercising the
// 400 paths in handleForecast, which validate query params before ever
// touching s.store.
func newBareServer() *Server {
	return &Server{
		cfg: &config.Config{CORSOrigins: []string{"*"}},
		log: slog.Default(),
	}
}

func TestHandleForecastValidation(t *testing.T) {
	s := newBareServer()
	valid := uuid.New().String()

	cases := []struct {
		name  string
		query string
		want  int
	}{
		{"missing ids", "", http.StatusBadRequest},
		{"empty ids", "ids=", http.StatusBadRequest},
		{"bad uuid", "ids=not-a-uuid", http.StatusBadRequest},
		{"too many ids", "ids=" + strings.Repeat(uuid.New().String()+",", 51), http.StatusBadRequest},
		{"non-numeric offset", "ids=" + valid + "&tz_offset_minutes=abc", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/courts/forecast?"+tc.query, nil)
			w := httptest.NewRecorder()
			s.handleForecast(w, req)
			if w.Code != tc.want {
				t.Errorf("status = %d, want %d (body: %s)", w.Code, tc.want, w.Body.String())
			}
		})
	}
}

// TestForecastRouteRegisteredAboveCourtsID verifies the route ordering
// requirement: GET /courts/forecast must resolve to handleForecast, not be
// swallowed by the /courts/{id} pattern (which would try to uuid.Parse
// "forecast" and 400 with a different message). Uses the real router with a
// bare (storeless) Server since a request with no ids never reaches the
// store.
func TestForecastRouteRegisteredAboveCourtsID(t *testing.T) {
	s := newBareServer()
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/v1/courts/forecast")
	if err != nil {
		t.Fatalf("GET /courts/forecast: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	var body apiError
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if strings.Contains(body.Error, "court id") {
		t.Fatalf("error = %q; looks like /courts/{id} swallowed the forecast route", body.Error)
	}
	if !strings.Contains(body.Error, "ids") {
		t.Fatalf("error = %q, want a message about the ids param (confirms handleForecast ran)", body.Error)
	}
}
