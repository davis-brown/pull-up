package api

import (
	"fmt"
	"time"
)

// Seasons (phase 22b) window XP so standing is re-competable: without them
// a leaderboard just ranks tenure, and a player who joined in year two can
// never catch someone who has been checking in since launch.
//
// A season is a calendar quarter in UTC. Quarters are long enough that a
// casual player still registers on a board and short enough that a season
// feels like a thing you can win. UTC (not per-user timezones) so every
// player's season starts and ends at the same instant — a leaderboard whose
// window depended on who was looking would rank people inconsistently.
//
// Nothing is stored. Season membership is derived from xp_events.created_at,
// which means seasons applied retroactively to history that predates them,
// and a season boundary needs no migration or backfill.
//
// The player's LIFETIME level is untouched by any of this. It stays their
// identity — resetting a visible level every quarter would take away
// something earned, which is the same mistake as decaying it. The season
// tier sits alongside it as the thing that resets.

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

// seasonKey is the stable machine identifier, e.g. "2026-Q3". Sortable as a
// string, which is why the quarter is zero-padded-by-construction rather
// than free-form.
func seasonKey(t time.Time) string {
	return fmt.Sprintf("%d-Q%d", t.UTC().Year(), seasonQuarter(t))
}

// seasonLabel is what a player sees, e.g. "Q3 2026".
func seasonLabel(t time.Time) string {
	return fmt.Sprintf("Q%d %d", seasonQuarter(t), t.UTC().Year())
}

// seasonInfo describes the season a payload is scoped to. Shared by
// /me/stats and both leaderboards so a client never has to guess whether
// two season-scoped numbers cover the same window.
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
