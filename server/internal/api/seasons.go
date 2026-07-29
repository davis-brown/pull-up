package api

import (
	"fmt"
	"time"
)

// Seasons window XP so standing is re-competable. A season is a calendar
// quarter in UTC — never per-user timezones, or a leaderboard's window would
// depend on who was looking.
//
// Nothing is stored: membership derives from xp_events.created_at, so a
// season boundary needs no migration or backfill. Lifetime level is
// untouched; only the season tier resets.

// seasonBounds returns the half-open interval [start, end) of the calendar
// quarter containing t.
func seasonBounds(t time.Time) (time.Time, time.Time) {
	t = t.UTC()
	// Months are 1-based, so subtract before flooring: Jan-Mar -> 0, Apr-Jun -> 3, …
	startMonth := time.Month(((int(t.Month())-1)/3)*3 + 1)
	start := time.Date(t.Year(), startMonth, 1, 0, 0, 0, 0, time.UTC)
	return start, start.AddDate(0, 3, 0)
}

// seasonQuarter is the 1-based quarter number containing t.
func seasonQuarter(t time.Time) int {
	return (int(t.UTC().Month())-1)/3 + 1
}

// seasonKey is the stable machine identifier, e.g. "2026-Q3". String-sortable.
func seasonKey(t time.Time) string {
	return fmt.Sprintf("%d-Q%d", t.UTC().Year(), seasonQuarter(t))
}

// seasonLabel is what a player sees, e.g. "Q3 2026".
func seasonLabel(t time.Time) string {
	return fmt.Sprintf("Q%d %d", seasonQuarter(t), t.UTC().Year())
}

// seasonInfo describes the season a payload is scoped to. Shared by
// /me/stats and both leaderboards.
type seasonInfo struct {
	Key       string    `json:"key"`
	Label     string    `json:"label"`
	StartedAt time.Time `json:"started_at"`
	EndsAt    time.Time `json:"ends_at"`
}

func currentSeason() seasonInfo {
	now := time.Now().UTC()
	start, end := seasonBounds(now)
	return seasonInfo{
		Key:       seasonKey(now),
		Label:     seasonLabel(now),
		StartedAt: start,
		EndsAt:    end,
	}
}
