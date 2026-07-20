package api

import (
	"testing"
	"time"
)

func TestSeasonBounds(t *testing.T) {
	utc := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 12, 30, 0, 0, time.UTC)
	}
	cases := []struct {
		name              string
		at                time.Time
		wantStart         time.Time
		wantEnd           time.Time
		wantKey, wantName string
	}{
		{
			name:      "first instant of a quarter belongs to it",
			at:        time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC),
			wantStart: time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC),
			wantKey:   "2026-Q3", wantName: "Q3 2026",
		},
		{
			name:      "mid-quarter",
			at:        utc(2026, time.August, 20),
			wantStart: time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC),
			wantKey:   "2026-Q3", wantName: "Q3 2026",
		},
		{
			name:      "January is Q1, not the previous year",
			at:        utc(2026, time.January, 1),
			wantStart: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, time.April, 1, 0, 0, 0, 0, time.UTC),
			wantKey:   "2026-Q1", wantName: "Q1 2026",
		},
		{
			name:      "Q4 rolls the year over, not the month",
			at:        utc(2026, time.December, 31),
			wantStart: time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2027, time.January, 1, 0, 0, 0, 0, time.UTC),
			wantKey:   "2026-Q4", wantName: "Q4 2026",
		},
		{
			name:      "March is still Q1",
			at:        utc(2026, time.March, 31),
			wantStart: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, time.April, 1, 0, 0, 0, 0, time.UTC),
			wantKey:   "2026-Q1", wantName: "Q1 2026",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end := seasonBounds(tc.at)
			if !start.Equal(tc.wantStart) {
				t.Errorf("start = %s, want %s", start, tc.wantStart)
			}
			if !end.Equal(tc.wantEnd) {
				t.Errorf("end = %s, want %s", end, tc.wantEnd)
			}
			if got := seasonKey(tc.at); got != tc.wantKey {
				t.Errorf("key = %q, want %q", got, tc.wantKey)
			}
			if got := seasonLabel(tc.at); got != tc.wantName {
				t.Errorf("label = %q, want %q", got, tc.wantName)
			}
		})
	}
}

// The interval must be half-open: an event at exactly the boundary belongs
// to the NEW season, never to both. Double-counting at a quarter boundary
// would inflate one leaderboard for three months.
func TestSeasonBoundsAreHalfOpenAndContiguous(t *testing.T) {
	start, end := seasonBounds(time.Date(2026, time.August, 20, 0, 0, 0, 0, time.UTC))
	nextStart, _ := seasonBounds(end)
	if !nextStart.Equal(end) {
		t.Errorf("next season starts at %s, want the previous end %s (no gap, no overlap)", nextStart, end)
	}
	if seasonKey(end) == seasonKey(start) {
		t.Errorf("the end instant %s is still in season %s; it must belong to the next", end, seasonKey(start))
	}
}

// A non-UTC input must resolve to the same season as its UTC instant: the
// window cannot depend on where the caller is.
func TestSeasonBoundsNormalizeToUTC(t *testing.T) {
	zone := time.FixedZone("UTC-10", -10*60*60)
	// 2026-07-01 01:00 UTC, expressed as 2026-06-30 15:00 in UTC-10. The
	// naive local reading is Q2; the correct answer is Q3.
	local := time.Date(2026, time.June, 30, 15, 0, 0, 0, zone)
	if got := seasonKey(local); got != "2026-Q3" {
		t.Errorf("seasonKey(%s) = %q, want 2026-Q3 (its UTC instant is in July)", local, got)
	}
}
