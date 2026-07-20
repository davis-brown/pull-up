import { levelProgressRatio, xpKindLabel, xpToNextLabel, XP_SOURCES } from "./levels";
import type { MeStats } from "./types";

function stats(overrides: Partial<MeStats>): MeStats {
  return {
    games: 0,
    courts: 0,
    week_streak: 0,
    badges: [],
    home_courts: [],
    level: 1,
    tier: "Rookie",
    xp: 0,
    xp_into_level: 0,
    xp_for_next_level: 50,
    wins: 0,
    losses: 0,
    xp_breakdown: [],
    level_up_pending: null,
    new_badges: [],
    season: {
      key: "2026-Q3",
      label: "Q3 2026",
      started_at: "2026-07-01T00:00:00Z",
      ends_at: "2026-10-01T00:00:00Z",
      xp: 0,
      tier: "Rookie",
    },
    ...overrides,
  };
}

describe("levelProgressRatio", () => {
  it("is the fraction of the way through the current level", () => {
    expect(levelProgressRatio(stats({ xp_into_level: 25, xp_for_next_level: 50 }))).toBe(0.5);
    expect(levelProgressRatio(stats({ xp_into_level: 0, xp_for_next_level: 50 }))).toBe(0);
  });

  it("reads full at the level cap, where there is no next level", () => {
    expect(levelProgressRatio(stats({ xp_into_level: 100, xp_for_next_level: 0 }))).toBe(1);
  });

  it("clamps rather than overflowing the bar", () => {
    expect(levelProgressRatio(stats({ xp_into_level: 80, xp_for_next_level: 50 }))).toBe(1);
    expect(levelProgressRatio(stats({ xp_into_level: -10, xp_for_next_level: 50 }))).toBe(0);
  });

  it("is empty before stats have loaded", () => {
    expect(levelProgressRatio(undefined)).toBe(0);
  });
});

describe("xpToNextLabel", () => {
  it("counts the XP still needed for the next level", () => {
    expect(xpToNextLabel(stats({ level: 3, xp_into_level: 15, xp_for_next_level: 50 }))).toBe(
      "35 XP to level 4",
    );
  });

  it("says so at the cap instead of promising a next level", () => {
    expect(xpToNextLabel(stats({ level: 99, xp_for_next_level: 0 }))).toBe("Max level");
  });

  it("never reports negative XP remaining", () => {
    expect(xpToNextLabel(stats({ level: 2, xp_into_level: 999, xp_for_next_level: 50 }))).toBe(
      "0 XP to level 3",
    );
  });

  it("renders nothing before stats have loaded", () => {
    expect(xpToNextLabel(undefined)).toBe("");
  });
});

describe("XP_SOURCES", () => {
  it("lists every earning route with a points label", () => {
    expect(XP_SOURCES.length).toBeGreaterThan(0);
    for (const src of XP_SOURCES) {
      expect(src.label).toBeTruthy();
      expect(src.points).toMatch(/^\+\d/);
    }
  });
});

describe("xpKindLabel", () => {
  it("names every award kind the server can send", () => {
    // Mirrors the kinds awarded in internal/api/xp.go and
    // games_handlers.go. An unnamed kind would render as a raw key.
    const kinds = [
      "check_in",
      "daily_first",
      "showed_up",
      "hosted_run",
      "court_verified",
      "fact_confirmed",
      "game_played",
      "streak_week",
    ];
    for (const kind of kinds) {
      expect(xpKindLabel(kind)).not.toBe(kind);
      expect(xpKindLabel(kind)).toBeTruthy();
    }
  });

  it("degrades readably for a kind shipped ahead of the app", () => {
    expect(xpKindLabel("some_future_award")).toBe("some future award");
  });
});
