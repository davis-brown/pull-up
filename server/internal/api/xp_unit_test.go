package api

import "testing"

func TestXPForLevelAndLevelFor(t *testing.T) {
	// The published curve: 25*(n-1)*n. Pinned so tuning it is a
	// deliberate act with a failing test, not a silent re-levelling of
	// every existing account.
	want := map[int]int{1: 0, 2: 50, 3: 150, 4: 300, 5: 500, 10: 2250, 20: 9500}
	for level, xp := range want {
		if got := xpForLevel(level); got != xp {
			t.Errorf("xpForLevel(%d) = %d, want %d", level, got, xp)
		}
	}

	// levelFor must be the exact inverse at every boundary: one XP short
	// of a threshold stays on the lower level, landing on it advances.
	for level := 2; level <= 30; level++ {
		threshold := xpForLevel(level)
		if got := levelFor(threshold - 1); got != level-1 {
			t.Errorf("levelFor(%d) = %d, want %d (one short of level %d)", threshold-1, got, level-1, level)
		}
		if got := levelFor(threshold); got != level {
			t.Errorf("levelFor(%d) = %d, want %d", threshold, got, level)
		}
	}
}

func TestLevelForEdgeCases(t *testing.T) {
	for xp, want := range map[int]int{0: 1, -50: 1, 1: 1, 49: 1, 50: 2} {
		if got := levelFor(xp); got != want {
			t.Errorf("levelFor(%d) = %d, want %d", xp, got, want)
		}
	}
	// An absurd total must terminate at the cap rather than spin.
	if got := levelFor(1 << 30); got != maxLevel {
		t.Errorf("levelFor(huge) = %d, want %d", got, maxLevel)
	}
}

func TestTierFor(t *testing.T) {
	for level, want := range map[int]string{
		1: "Rookie", 4: "Rookie", 5: "Regular", 9: "Regular",
		10: "Starter", 15: "Veteran", 20: "All-Star", 29: "All-Star",
		30: "Legend", 99: "Legend",
	} {
		if got := tierFor(level); got != want {
			t.Errorf("tierFor(%d) = %q, want %q", level, got, want)
		}
	}
}

func TestProgressFor(t *testing.T) {
	// Mid-level: 200 XP is level 3 (floor 150), 50 into a 150-wide level.
	p := progressFor(200)
	if p.Level != 3 || p.Tier != "Rookie" || p.XPIntoLevel != 50 || p.XPForNextLevel != 150 {
		t.Errorf("progressFor(200) = %+v, want level 3, Rookie, 50/150", p)
	}
	// Exactly on a threshold: zero progress into the new level.
	if p := progressFor(150); p.Level != 3 || p.XPIntoLevel != 0 {
		t.Errorf("progressFor(150) = %+v, want level 3 with 0 into it", p)
	}
	// A brand-new account.
	if p := progressFor(0); p.Level != 1 || p.XPIntoLevel != 0 || p.XPForNextLevel != 50 {
		t.Errorf("progressFor(0) = %+v, want level 1, 0/50", p)
	}
	// At the cap the bar reads full rather than dividing by zero.
	if p := progressFor(xpForLevel(maxLevel)); p.Level != maxLevel || p.XPForNextLevel != 0 {
		t.Errorf("progressFor(max) = %+v, want level %d with no next", p, maxLevel)
	}
	// Negative totals can't happen through the ledger, but must not panic.
	if p := progressFor(-10); p.Level != 1 || p.XP != 0 {
		t.Errorf("progressFor(-10) = %+v, want a clamped level-1 result", p)
	}
}
