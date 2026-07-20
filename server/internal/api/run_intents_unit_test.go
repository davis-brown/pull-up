package api

import (
	"testing"
	"time"
)

func TestParseIntentBucket(t *testing.T) {
	// Jul 16 2026 is a Thursday, Jul 18 a Saturday; "now" sits mid-morning
	// UTC so today/tomorrow arithmetic isn't near a day boundary.
	now := time.Date(2026, 7, 16, 10, 0, 0, 0, time.UTC)

	cases := []struct {
		name    string
		req     runIntentRequest
		wantErr bool
		wantISO string
	}{
		{"today, matching weekday window", runIntentRequest{RunDate: "2026-07-16", WindowKey: "weekday_evening"}, false, "2026-07-16"},
		{"exactly maxIntentLeadDays out", runIntentRequest{RunDate: "2026-07-23", WindowKey: "weekday_evening"}, false, "2026-07-23"},
		{"one day past the lead window", runIntentRequest{RunDate: "2026-07-24", WindowKey: "weekday_evening"}, true, ""},
		{"in the past", runIntentRequest{RunDate: "2026-07-15", WindowKey: "weekday_evening"}, true, ""},
		{"weekend window on a weekday date", runIntentRequest{RunDate: "2026-07-16", WindowKey: "weekend_evening"}, true, ""},
		{"weekday window on a weekend date", runIntentRequest{RunDate: "2026-07-18", WindowKey: "weekday_evening"}, true, ""},
		{"weekend window on the matching weekend date", runIntentRequest{RunDate: "2026-07-18", WindowKey: "weekend_morning"}, false, "2026-07-18"},
		{"unknown window key", runIntentRequest{RunDate: "2026-07-16", WindowKey: "not_a_window"}, true, ""},
		{"unparseable date", runIntentRequest{RunDate: "not-a-date", WindowKey: "weekday_evening"}, true, ""},
	}
	for _, tc := range cases {
		date, err := parseIntentBucket(tc.req, now)
		if tc.wantErr {
			if err == nil {
				t.Errorf("%s: got no error, want one", tc.name)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: unexpected error: %v", tc.name, err)
			continue
		}
		if got := date.Format("2006-01-02"); got != tc.wantISO {
			t.Errorf("%s: date = %s, want %s", tc.name, got, tc.wantISO)
		}
	}
}

func TestBucketForSessionTime(t *testing.T) {
	cases := []struct {
		name       string
		t          time.Time
		wantOK     bool
		wantDate   string
		wantWindow string
	}{
		{"weekday evening", time.Date(2026, 7, 16, 18, 0, 0, 0, time.UTC), true, "2026-07-16", "weekday_evening"},
		{"weekend morning", time.Date(2026, 7, 18, 8, 0, 0, 0, time.UTC), true, "2026-07-18", "weekend_morning"},
		{"outside every window (late night)", time.Date(2026, 7, 16, 2, 0, 0, 0, time.UTC), false, "", ""},
	}
	for _, tc := range cases {
		date, windowKey, ok := bucketForSessionTime(tc.t)
		if ok != tc.wantOK {
			t.Errorf("%s: ok = %v, want %v", tc.name, ok, tc.wantOK)
			continue
		}
		if !ok {
			continue
		}
		if got := date.Format("2006-01-02"); got != tc.wantDate {
			t.Errorf("%s: date = %s, want %s", tc.name, got, tc.wantDate)
		}
		if windowKey != tc.wantWindow {
			t.Errorf("%s: windowKey = %s, want %s", tc.name, windowKey, tc.wantWindow)
		}
	}
}

func TestBucketLabel(t *testing.T) {
	// bucketLabel compares against real time.Now(), so pin dates relative
	// to it rather than a fixed calendar date.
	today := time.Now().UTC().Truncate(24 * time.Hour)
	if got := bucketLabel(today, "evening"); got != "Today evening" {
		t.Errorf("today: bucketLabel = %q, want %q", got, "Today evening")
	}
	if got := bucketLabel(today.AddDate(0, 0, 1), "morning"); got != "Tomorrow morning" {
		t.Errorf("tomorrow: bucketLabel = %q, want %q", got, "Tomorrow morning")
	}
	later := today.AddDate(0, 0, 5)
	if got := bucketLabel(later, "lunch"); got == "Today lunch" || got == "Tomorrow lunch" {
		t.Errorf("5 days out: bucketLabel = %q, want a weekday name", got)
	}
}
