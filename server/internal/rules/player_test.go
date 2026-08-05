package rules_test

import (
	"testing"
	"time"

	"github.com/davisbrown/pull-up/server/internal/rules"
)

// -- badges -----------------------------------------------------------------
//
// This is the rule that decides whether a player gets a celebration popup.
// Previously it could only be exercised against a live database.

func TestReconcileBadgesBaselineMarksEverythingSeen(t *testing.T) {
	toRecord, unseen := rules.ReconcileBadges(
		[]string{"first_run", "explorer"}, map[string]rules.BadgeState{}, true)

	if len(unseen) != 0 {
		t.Errorf("baseline reported %v as new; a long-standing player must not be shown old badges", unseen)
	}
	// They are still persisted, just as already-seen.
	if len(toRecord) != 2 {
		t.Errorf("toRecord = %v, want both recorded", toRecord)
	}
}

func TestReconcileBadgesReportsNewlyEarnedAfterBaseline(t *testing.T) {
	known := map[string]rules.BadgeState{
		"first_run": {EarnedAt: time.Now().Add(-72 * time.Hour), Seen: true},
	}

	toRecord, unseen := rules.ReconcileBadges([]string{"first_run", "explorer"}, known, false)

	if len(toRecord) != 1 || toRecord[0] != "explorer" {
		t.Errorf("toRecord = %v, want just explorer", toRecord)
	}
	if len(unseen) != 1 || unseen[0] != "explorer" {
		t.Errorf("unseen = %v, want just explorer (first_run was already shown)", unseen)
	}
}

// A badge recorded but never shown must keep coming back until acknowledged.
func TestReconcileBadgesRepeatsUnseenBadges(t *testing.T) {
	known := map[string]rules.BadgeState{
		"first_run": {EarnedAt: time.Now().Add(-time.Hour), Seen: false},
	}

	toRecord, unseen := rules.ReconcileBadges([]string{"first_run"}, known, false)

	if len(toRecord) != 0 {
		t.Errorf("toRecord = %v, want nothing re-recorded", toRecord)
	}
	if len(unseen) != 1 || unseen[0] != "first_run" {
		t.Errorf("unseen = %v, want first_run to persist until acknowledged", unseen)
	}
}

func TestReconcileBadgesWithNothingEarned(t *testing.T) {
	toRecord, unseen := rules.ReconcileBadges(nil, map[string]rules.BadgeState{}, false)
	if len(toRecord) != 0 || len(unseen) != 0 {
		t.Errorf("toRecord=%v unseen=%v, want both empty", toRecord, unseen)
	}
}

// The unseen list must follow the caller's order, not map order, so the
// celebration sequence is deterministic.
func TestReconcileBadgesPreservesOrder(t *testing.T) {
	want := []string{"first_run", "explorer", "early_bird", "regular", "streak_4", "host"}

	_, unseen := rules.ReconcileBadges(want, map[string]rules.BadgeState{}, false)

	if len(unseen) != len(want) {
		t.Fatalf("unseen = %v, want all six", unseen)
	}
	for i := range want {
		if unseen[i] != want[i] {
			t.Errorf("unseen[%d] = %q, want %q", i, unseen[i], want[i])
		}
	}
}

// -- game scores ------------------------------------------------------------

func TestValidateGameScore(t *testing.T) {
	// Most pickup games are not counted; no score at all is fine.
	if msg := rules.ValidateGameScore(nil, nil); msg != "" {
		t.Errorf("a game with no score was rejected: %s", msg)
	}
	// A half-recorded result is worse than none.
	if msg := rules.ValidateGameScore(ptr(21), nil); msg == "" {
		t.Error("a score with no losing side was accepted")
	}
	if msg := rules.ValidateGameScore(nil, ptr(19)); msg == "" {
		t.Error("a losing score with no winner was accepted")
	}
	// The winner must actually have scored more.
	if msg := rules.ValidateGameScore(ptr(10), ptr(21)); msg == "" {
		t.Error("a winning score lower than the losing one was accepted")
	}
	// A tie contradicts the separately-recorded winning team.
	if msg := rules.ValidateGameScore(ptr(21), ptr(21)); msg == "" {
		t.Error("a tied score was accepted")
	}
	for _, pair := range [][2]int{{rules.MaxGameScore + 1, 1}, {-1, -2}, {5, -1}} {
		if msg := rules.ValidateGameScore(ptr(pair[0]), ptr(pair[1])); msg == "" {
			t.Errorf("out-of-range score %v was accepted", pair)
		}
	}
	if msg := rules.ValidateGameScore(ptr(21), ptr(19)); msg != "" {
		t.Errorf("a normal score was rejected: %s", msg)
	}
}

// -- profile privacy --------------------------------------------------------

// A private account's activity is hidden from strangers, shown to followers,
// and always shown to its owner.
func TestHidesActivity(t *testing.T) {
	cases := []struct {
		name                           string
		private, self, following, want bool
	}{
		{"a public account hides nothing", false, false, false, false},
		{"a private account hides from a stranger", true, false, false, true},
		{"a private account shows its owner", true, true, false, false},
		{"a private account shows its followers", true, false, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := rules.HidesActivity(tc.private, tc.self, tc.following); got != tc.want {
				t.Errorf("HidesActivity(%v,%v,%v) = %v, want %v",
					tc.private, tc.self, tc.following, got, tc.want)
			}
		})
	}
}

// A private account's follower list is as sensitive as its activity.
func TestCanListConnections(t *testing.T) {
	if rules.CanListConnections(true, false, false) {
		t.Error("a stranger could list a private account's followers")
	}
	if !rules.CanListConnections(true, false, true) {
		t.Error("an accepted follower could not list connections")
	}
	if !rules.CanListConnections(true, true, false) {
		t.Error("an owner could not list their own connections")
	}
	if !rules.CanListConnections(false, false, false) {
		t.Error("a public account's connections were gated")
	}
}
