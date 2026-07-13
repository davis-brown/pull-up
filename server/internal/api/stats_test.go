package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// mustMonday parses a "2006-01-02" date that must fall on a Monday
// (verified below) — the same granularity UserCheckInWeeks returns
// (date_trunc('week', …)::date).
func mustMonday(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		t.Fatalf("parse %q: %v", s, err)
	}
	if d.Weekday() != time.Monday {
		t.Fatalf("%q is a %s, not a Monday — fix the fixture", s, d.Weekday())
	}
	return d
}

// -- weekStreak -----------------------------------------------------------
// Mirrors the brief's exact ISO-week-label cases, translated to
// week-start dates (the representation stats.sql/UserCheckInWeeks
// actually returns): 2026-W24..27 are the four Mondays below, and the
// year-boundary case uses the real Dec29/Jan5 pair.

func TestWeekStreak(t *testing.T) {
	wk24 := mustMonday(t, "2026-06-08")
	wk25 := mustMonday(t, "2026-06-15")
	wk26 := mustMonday(t, "2026-06-22")
	wk27 := mustMonday(t, "2026-06-29")
	wk20 := mustMonday(t, "2026-05-11")

	cases := []struct {
		name  string
		weeks []time.Time
		now   time.Time
		want  int
	}{
		{
			name:  "three consecutive weeks ending now",
			weeks: []time.Time{wk24, wk25, wk26},
			now:   wk26,
			want:  3,
		},
		{
			name:  "gap breaks the streak",
			weeks: []time.Time{wk20, wk25, wk26},
			now:   wk26,
			want:  2,
		},
		{
			name:  "nothing checked in yet this week; last week's streak still counts",
			weeks: []time.Time{wk20, wk25, wk26},
			now:   wk27,
			want:  2,
		},
		{
			name:  "no check-ins ever",
			weeks: nil,
			now:   wk26,
			want:  0,
		},
		{
			name:  "year boundary is not a break",
			weeks: []time.Time{mustMonday(t, "2025-12-29"), mustMonday(t, "2026-01-05")},
			now:   mustMonday(t, "2026-01-05"),
			want:  2,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := weekStreak(tc.weeks, tc.now); got != tc.want {
				t.Errorf("weekStreak(%v, now=%v) = %d, want %d", tc.weeks, tc.now, got, tc.want)
			}
		})
	}
}

// -- mondayWeekStart --------------------------------------------------------

func TestMondayWeekStart(t *testing.T) {
	cases := []struct {
		name string
		in   time.Time
		want time.Time
	}{
		{"already Monday midnight", mustMonday(t, "2026-06-22"), mustMonday(t, "2026-06-22")},
		{"Wednesday", time.Date(2026, 6, 24, 15, 30, 0, 0, time.UTC), mustMonday(t, "2026-06-22")},
		{"Sunday rolls back to the Monday that started its week", time.Date(2026, 6, 28, 23, 59, 0, 0, time.UTC), mustMonday(t, "2026-06-22")},
		{"year boundary: Jan 1 2026 (Thursday) belongs to the week starting Dec 29", time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC), mustMonday(t, "2025-12-29")},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := mondayWeekStart(tc.in); !got.Equal(tc.want) {
				t.Errorf("mondayWeekStart(%v) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// -- deriveBadges -----------------------------------------------------------

func TestDeriveBadgesThresholds(t *testing.T) {
	allUnearned := deriveBadges(statsBadgeInputs{})
	wantIDs := []string{"first_run", "explorer", "early_bird", "regular", "streak_4", "host"}
	if len(allUnearned) != len(wantIDs) {
		t.Fatalf("len(badges) = %d, want %d", len(allUnearned), len(wantIDs))
	}
	for i, b := range allUnearned {
		if b.ID != wantIDs[i] {
			t.Errorf("badges[%d].ID = %q, want %q (order matters: brief's response shape)", i, b.ID, wantIDs[i])
		}
		if b.Earned {
			t.Errorf("badge %q should be unearned with zero inputs", b.ID)
		}
	}

	cases := []struct {
		name   string
		in     statsBadgeInputs
		id     string
		earned bool
	}{
		{"first_run at 0", statsBadgeInputs{Games: 0}, "first_run", false},
		{"first_run at 1", statsBadgeInputs{Games: 1}, "first_run", true},

		{"explorer at 4", statsBadgeInputs{Courts: 4}, "explorer", false},
		{"explorer at 5", statsBadgeInputs{Courts: 5}, "explorer", true},

		{"early_bird at 4", statsBadgeInputs{EarlyCount: 4}, "early_bird", false},
		{"early_bird at 5", statsBadgeInputs{EarlyCount: 5}, "early_bird", true},

		{"regular at 9", statsBadgeInputs{MaxAtOneCourt: 9}, "regular", false},
		{"regular at 10", statsBadgeInputs{MaxAtOneCourt: 10}, "regular", true},

		{"streak_4 at 3", statsBadgeInputs{WeekStreak: 3}, "streak_4", false},
		{"streak_4 at 4", statsBadgeInputs{WeekStreak: 4}, "streak_4", true},

		{"host at 2", statsBadgeInputs{SessionsCount: 2}, "host", false},
		{"host at 3", statsBadgeInputs{SessionsCount: 3}, "host", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			badges := deriveBadges(tc.in)
			for _, b := range badges {
				if b.ID != tc.id {
					continue
				}
				if b.Earned != tc.earned {
					t.Errorf("badge %q earned = %v, want %v (input %+v)", tc.id, b.Earned, tc.earned, tc.in)
				}
				return
			}
			t.Fatalf("badge %q not found in output", tc.id)
		})
	}
}

func TestDeriveBadgesAllEarned(t *testing.T) {
	badges := deriveBadges(statsBadgeInputs{
		Games: 34, Courts: 9, EarlyCount: 6, MaxAtOneCourt: 21, WeekStreak: 5, SessionsCount: 3,
	})
	for _, b := range badges {
		if !b.Earned {
			t.Errorf("badge %q should be earned given generous inputs", b.ID)
		}
	}
}

// -- handler-level validation (no DB touched on this path) -----------------

func TestHandleMeStatsValidation(t *testing.T) {
	s := newBareServer()
	req := httptest.NewRequest(http.MethodGet, "/me/stats?tz_offset_minutes=abc", nil)
	w := httptest.NewRecorder()
	s.handleMeStats(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (body: %s)", w.Code, w.Body.String())
	}
}
