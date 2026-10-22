package api

import (
	"testing"
	"time"
)

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
