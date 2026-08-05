package rules_test

import (
	"testing"
	"time"

	"github.com/davisbrown/pull-up/server/internal/rules"
)

// -- refresh token rotation -------------------------------------------------
//
// The most security-sensitive logic in the service. Before these existed it
// could only be exercised by booting Postgres and driving HTTP.

func TestDecideRefreshRotatesALiveToken(t *testing.T) {
	now := time.Now()
	if got := rules.DecideRefresh(now.Add(time.Hour), nil, now); got != rules.RefreshRotate {
		t.Errorf("decision = %v, want RefreshRotate", got)
	}
}

func TestDecideRefreshRejectsAnExpiredToken(t *testing.T) {
	now := time.Now()
	if got := rules.DecideRefresh(now.Add(-time.Second), nil, now); got != rules.RefreshExpired {
		t.Errorf("decision = %v, want RefreshExpired", got)
	}
}

// A second presentation shortly after rotation is a concurrent replay: refuse,
// but leave the family alone so the legitimate request's token still works.
func TestDecideRefreshTreatsAPromptReplayAsConcurrent(t *testing.T) {
	now := time.Now()
	revoked := now.Add(-time.Second)
	if got := rules.DecideRefresh(now.Add(time.Hour), &revoked, now); got != rules.RefreshReplayWithinGrace {
		t.Errorf("decision = %v, want RefreshReplayWithinGrace", got)
	}
}

// Past the grace window, a rotated token resurfacing is treated as theft.
func TestDecideRefreshRevokesTheFamilyOnLateReplay(t *testing.T) {
	now := time.Now()
	revoked := now.Add(-rules.RefreshReplayGrace - time.Second)
	if got := rules.DecideRefresh(now.Add(time.Hour), &revoked, now); got != rules.RefreshReplayRevokeFamily {
		t.Errorf("decision = %v, want RefreshReplayRevokeFamily", got)
	}
}

// The ordering guarantee, and the reason the expiry check comes first: an
// EXPIRED token that was also previously rotated must report Expired, never
// RevokeFamily. Otherwise anyone holding an old leaked token could force-log
// the real user out of every one of their devices.
func TestRefreshExpiryIsCheckedBeforeReuse(t *testing.T) {
	now := time.Now()
	revoked := now.Add(-24 * time.Hour)
	got := rules.DecideRefresh(now.Add(-time.Hour), &revoked, now)
	if got != rules.RefreshExpired {
		t.Errorf("decision = %v, want RefreshExpired — an expired token must be inert, not a logout primitive", got)
	}
}

// Same reasoning for logout: only the current, unexpired token may revoke a
// family.
func TestCanLogoutFamily(t *testing.T) {
	now := time.Now()
	revoked := now.Add(-time.Minute)

	if !rules.CanLogoutFamily(now.Add(time.Hour), nil, now) {
		t.Error("a live token could not log out its family")
	}
	if rules.CanLogoutFamily(now.Add(-time.Hour), nil, now) {
		t.Error("an expired token was allowed to revoke a family")
	}
	if rules.CanLogoutFamily(now.Add(time.Hour), &revoked, now) {
		t.Error("an already-revoked token was allowed to revoke a family")
	}
}

// -- level crossing ---------------------------------------------------------

// levelFor mirrors the published curve (25*(n-1)*n) closely enough to exercise
// the crossing rule; the curve itself is tested in internal/api.
func levelFor(xp int) int {
	if xp <= 0 {
		return 1
	}
	level := 1
	for level < 99 && xp >= 25*level*(level+1) {
		level++
	}
	return level
}

func TestCrossedLevel(t *testing.T) {
	// 50 XP is exactly level 2. An award of 10 landing on 50 crosses.
	if level, ok := rules.CrossedLevel(50, 10, levelFor); !ok || level != 2 {
		t.Errorf("CrossedLevel(50, 10) = (%d, %v), want (2, true)", level, ok)
	}
	// The next award, still inside level 2, must not re-fire the push.
	if level, ok := rules.CrossedLevel(60, 10, levelFor); ok {
		t.Errorf("CrossedLevel(60, 10) = (%d, true), want no crossing", level)
	}
	// One XP short of the threshold is not a crossing.
	if _, ok := rules.CrossedLevel(49, 10, levelFor); ok {
		t.Error("CrossedLevel(49, 10) reported a crossing below the threshold")
	}
	// A deduplicated or capped-out award grants nothing and crosses nothing.
	if _, ok := rules.CrossedLevel(500, 0, levelFor); ok {
		t.Error("CrossedLevel with 0 awarded reported a crossing")
	}
	// A single large award may span more than one level; report the level
	// actually reached.
	if level, ok := rules.CrossedLevel(300, 300, levelFor); !ok || level != 4 {
		t.Errorf("CrossedLevel(300, 300) = (%d, %v), want (4, true)", level, ok)
	}
}
