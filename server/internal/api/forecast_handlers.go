package api

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	// forecastMaxIDs caps how many courts a single forecast request can
	// batch (the client-side time scrubber fetches once for the courts
	// visible in the current viewport).
	forecastMaxIDs = 50
	// forecastWeeks is the trailing window (in weeks) the hourly averages
	// are computed over; bucket totals are divided by this to get an
	// average concurrent headcount per local hour.
	forecastWeeks = 8.0
	// tzOffsetClampMinutes bounds tz_offset_minutes to a plausible range
	// (UTC-14..UTC+14, the widest real-world UTC offsets).
	tzOffsetClampMinutes = 840
)

// forecastSession is a today-scheduled, non-canceled run for a court, in the
// caller's local time; the client overlays these onto the hourly forecast.
type forecastSession struct {
	SessionID uuid.UUID `json:"session_id"`
	Hour      int       `json:"hour"`
	StartsAt  time.Time `json:"starts_at"`
	Going     int       `json:"going"`
}

// courtForecast is the per-court forecast payload: average concurrent
// headcount per local hour today (over the trailing 8 weeks), plus today's
// scheduled sessions.
type courtForecast struct {
	CourtID    uuid.UUID         `json:"court_id"`
	Hours      [24]int           `json:"hours"`
	HasHistory bool              `json:"has_history"`
	Sessions   []forecastSession `json:"sessions"`
}

// parseForecastIDs parses the comma-separated ids query param into 1-50
// UUIDs. ok is false when the value is missing/empty, exceeds 50 ids, or
// contains any invalid UUID — all of which the caller maps to a 400.
func parseForecastIDs(raw string) (ids []uuid.UUID, ok bool) {
	if strings.TrimSpace(raw) == "" {
		return nil, false
	}
	parts := strings.Split(raw, ",")
	if len(parts) > forecastMaxIDs {
		return nil, false
	}
	out := make([]uuid.UUID, 0, len(parts))
	for _, p := range parts {
		id, err := uuid.Parse(strings.TrimSpace(p))
		if err != nil {
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}

// parseTzOffsetMinutes parses the tz_offset_minutes query param, defaulting
// to 0 when absent and clamping to +/-840. A non-numeric value is a parse
// error the caller maps to a 400.
func parseTzOffsetMinutes(raw string) (minutes int, ok bool) {
	if raw == "" {
		return 0, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	switch {
	case n > tzOffsetClampMinutes:
		n = tzOffsetClampMinutes
	case n < -tzOffsetClampMinutes:
		n = -tzOffsetClampMinutes
	}
	return n, true
}

// forecastDayBounds computes the Postgres-style day-of-week (0=Sunday..
// 6=Saturday) and the [start, end) UTC instants spanning "today" in the
// caller's local offset, as of now.
func forecastDayBounds(now time.Time, offsetMinutes int) (dow int, dayStart, dayEnd time.Time) {
	offset := time.Duration(offsetMinutes) * time.Minute
	local := now.UTC().Add(offset)
	dow = int(local.Weekday())
	localMidnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
	dayStart = localMidnight.Add(-offset)
	dayEnd = dayStart.Add(24 * time.Hour)
	return dow, dayStart, dayEnd
}

// localHour returns t's hour after shifting by the caller's local offset,
// matching the SQL EXTRACT(HOUR FROM (t + offset)) used in forecast.sql.
func localHour(t time.Time, offsetMinutes int) int {
	return t.UTC().Add(time.Duration(offsetMinutes) * time.Minute).Hour()
}

// averageHeads turns an 8-week bucket total into an average concurrent
// headcount, rounded to the nearest int (not truncated).
func averageHeads(total int32) int {
	return int(math.Round(float64(total) / forecastWeeks))
}

// buildForecasts assembles the per-court forecast payloads in ids order.
// A court with no matching history rows gets has_history:false and
// all-zero hours; sessions are attached independently of history.
func buildForecasts(
	ids []uuid.UUID,
	historyRows []gen.CourtHourlyCheckInHistoryRow,
	sessionRows []gen.CourtSessionsForDayRow,
	offsetMinutes int,
) []courtForecast {
	out := make([]courtForecast, len(ids))
	byCourt := make(map[uuid.UUID]*courtForecast, len(ids))
	for i, id := range ids {
		out[i] = courtForecast{CourtID: id, Sessions: []forecastSession{}}
		byCourt[id] = &out[i]
	}
	for _, row := range historyRows {
		cf, found := byCourt[row.CourtID]
		if !found {
			continue
		}
		hour := int(row.LocalHour)
		if hour < 0 || hour > 23 {
			continue // defensive; EXTRACT(HOUR) never leaves 0-23
		}
		cf.Hours[hour] = averageHeads(row.TotalHeads)
		cf.HasHistory = true
	}
	for _, row := range sessionRows {
		cf, found := byCourt[row.CourtID]
		if !found {
			continue
		}
		cf.Sessions = append(cf.Sessions, forecastSession{
			SessionID: row.ID,
			Hour:      localHour(row.StartsAt, offsetMinutes),
			StartsAt:  row.StartsAt,
			Going:     int(row.Going),
		})
	}
	return out
}

// handleForecast serves the hourly turnout forecast for a batch of courts:
// per-court average concurrent headcount per local hour today (trailing 8
// weeks), plus today's scheduled sessions. Public, unauthenticated.
func (s *Server) handleForecast(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	ids, ok := parseForecastIDs(q.Get("ids"))
	if !ok {
		writeError(w, http.StatusBadRequest, "ids must be 1-50 comma-separated UUIDs")
		return
	}
	offsetMinutes, ok := parseTzOffsetMinutes(q.Get("tz_offset_minutes"))
	if !ok {
		writeError(w, http.StatusBadRequest, "tz_offset_minutes must be an integer")
		return
	}

	dow, dayStart, dayEnd := forecastDayBounds(time.Now(), offsetMinutes)

	historyRows, err := s.store.Queries.CourtHourlyCheckInHistory(r.Context(), gen.CourtHourlyCheckInHistoryParams{
		TzOffsetMinutes: int32(offsetMinutes),
		CourtIds:        ids,
		Dow:             int32(dow),
	})
	if err != nil {
		s.internalError(w, "court hourly check-in history", err)
		return
	}
	sessionRows, err := s.store.Queries.CourtSessionsForDay(r.Context(), gen.CourtSessionsForDayParams{
		CourtIds: ids,
		DayStart: dayStart,
		DayEnd:   dayEnd,
	})
	if err != nil {
		s.internalError(w, "court sessions for day", err)
		return
	}

	forecasts := buildForecasts(ids, historyRows, sessionRows, offsetMinutes)
	writeJSON(w, http.StatusOK, map[string]any{"forecasts": forecasts})
}
