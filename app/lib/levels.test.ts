import { levelProgressRatio, xpToNextLabel, XP_SOURCES } from "./levels";
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
