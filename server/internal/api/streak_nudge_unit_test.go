package api

import (
	"testing"
	"time"
)

func TestNudgeEligible(t *testing.T) {
	// Jul 2026: 13th is a Monday, so 16th=Thu, 17th=Fri, 18th=Sat, 19th=Sun.
	at := func(day, hour int) time.Time {
		return time.Date(2026, 7, day, hour, 0, 0, 0, time.UTC)
	}
	cases := []struct {
		name string
		t    time.Time
		want bool
	}{
		{"Thursday evening", at(16, 18), true},
		{"Friday evening", at(17, 17), true},   // window start is inclusive
		{"Saturday evening", at(18, 20), true}, // 20:00 is still inside
		{"Saturday at the window end", at(18, 21), false},
		{"Thursday afternoon", at(16, 15), false},
		{"Thursday middle of the night", at(16, 3), false},
		{"Sunday evening (too late to help)", at(19, 18), false},
		{"Monday evening (too early to nag)", at(13, 18), false},
		{"Wednesday evening", at(15, 18), false},
	}
	for _, tc := range cases {
		if got := nudgeEligible(tc.t); got != tc.want {
			t.Errorf("%s: nudgeEligible = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestDaysLeftInStreakWeek(t *testing.T) {
	// Monday-start week; Sunday is the last day, so Saturday has 1 left.
	for day, want := range map[int]int{13: 7, 16: 4, 17: 3, 18: 2, 19: 1} {
		got := daysLeftInStreakWeek(time.Date(2026, 7, day, 18, 0, 0, 0, time.UTC))
		if got != want {
			t.Errorf("Jul %d: daysLeftInStreakWeek = %d, want %d", day, got, want)
		}
	}
}

func TestStreakNudgeBody(t *testing.T) {
	if got, want := streakNudgeBody(6, 3), "Your 6-week streak needs a run — 3 days left."; got != want {
		t.Errorf("streakNudgeBody(6, 3) = %q, want %q", got, want)
	}
	// Singular day, so the copy never reads "1 days left".
	if got, want := streakNudgeBody(1, 1), "Your 1-week streak needs a run — 1 day left."; got != want {
		t.Errorf("streakNudgeBody(1, 1) = %q, want %q", got, want)
	}
}
