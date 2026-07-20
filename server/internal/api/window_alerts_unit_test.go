package api

import (
	"slices"
	"testing"
	"time"
)

// The Go span table must cover exactly the availability keys the PATCH /me
// validator accepts (which the app's player.ts list is in turn pinned to by
// its own jest test) — a window added in one place cannot silently miss the
// alert path.
func TestWindowSpansMatchValidAvailability(t *testing.T) {
	var spanKeys []string
	for _, s := range windowSpans {
		spanKeys = append(spanKeys, s.key)
	}
	slices.Sort(spanKeys)
	valid := slices.Clone(validAvailability)
	slices.Sort(valid)
	if !slices.Equal(spanKeys, valid) {
		t.Errorf("windowSpans keys %v != validAvailability %v", spanKeys, valid)
	}
}

func TestMatchedWindowLabel(t *testing.T) {
	// Jul 16 2026 is a Thursday, Jul 18 a Saturday.
	thursdayEvening := time.Date(2026, 7, 16, 18, 0, 0, 0, time.UTC)
	saturdayMorning := time.Date(2026, 7, 18, 10, 0, 0, 0, time.UTC)

	cases := []struct {
		name         string
		availability []string
		at           time.Time
		want         string
	}{
		{"weekday evening hit", []string{"weekday_evening"}, thursdayEvening, "evening"},
		{"weekend key on a weekday misses", []string{"weekend_evening"}, thursdayEvening, ""},
		{"weekend morning hit", []string{"weekend_morning"}, saturdayMorning, "morning"},
		{"end hour is exclusive", []string{"weekday_evening"}, time.Date(2026, 7, 16, 22, 0, 0, 0, time.UTC), ""},
		{"start hour is inclusive", []string{"weekday_evening"}, time.Date(2026, 7, 16, 17, 0, 0, 0, time.UTC), "evening"},
		{"no windows", nil, thursdayEvening, ""},
		{"unknown key ignored", []string{"not_a_window"}, thursdayEvening, ""},
	}
	for _, tc := range cases {
		if got := matchedWindowLabel(tc.availability, tc.at); got != tc.want {
			t.Errorf("%s: matchedWindowLabel = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestValidTimezone(t *testing.T) {
	for tz, want := range map[string]bool{
		"America/Chicago": true,
		"Etc/GMT+5":       true,
		"UTC":             true,
		"":                false,
		"Local":           false,
		"Not/AZone":       false,
	} {
		if got := validTimezone(tz); got != want {
			t.Errorf("validTimezone(%q) = %v, want %v", tz, got, want)
		}
	}
}
