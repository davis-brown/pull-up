import type { CourtForecast } from "./forecast";
import { AVAILABILITY_WINDOWS } from "./player";
import {
  todaysWindows,
  WINDOW_SPANS,
  yourWindowHours,
  yourWindowSummary,
} from "./your-window";

// Fixed local dates: Jul 19 2026 is a Sunday, so the 16th is a Thursday and
// the 18th a Saturday.
const thursday = new Date(2026, 6, 16, 12, 0);
const saturday = new Date(2026, 6, 18, 12, 0);

function forecastWith(hours: Record<number, number>, hasHistory = true): CourtForecast {
  const arr = Array(24).fill(0);
  for (const [h, v] of Object.entries(hours)) arr[Number(h)] = v;
  return { court_id: "court-1", hours: arr, has_history: hasHistory, weeks: 8, sessions: [] };
}

describe("WINDOW_SPANS", () => {
  it("covers exactly the availability keys players can pick in settings", () => {
    // A window added to profile settings without a span here would silently
    // miss the lens (and vice versa) — this pins the two lists together.
    expect(WINDOW_SPANS.map((w) => w.key).sort()).toEqual(
      AVAILABILITY_WINDOWS.map((w) => w.key).sort(),
    );
  });
});

describe("todaysWindows", () => {
  it("keeps only weekday windows on a weekday", () => {
    const spans = todaysWindows(["weekday_evening", "weekend_morning"], thursday);
    expect(spans.map((w) => w.key)).toEqual(["weekday_evening"]);
  });

  it("keeps only weekend windows on a weekend", () => {
    const spans = todaysWindows(["weekday_evening", "weekend_morning"], saturday);
    expect(spans.map((w) => w.key)).toEqual(["weekend_morning"]);
  });

  it("ignores unknown availability keys", () => {
    expect(todaysWindows(["not_a_window"], thursday)).toEqual([]);
    expect(todaysWindows([], thursday)).toEqual([]);
  });
});

describe("yourWindowHours", () => {
  it("unions the hour spans of all of today's windows", () => {
    const hours = yourWindowHours(["weekday_morning", "weekday_evening"], thursday);
    expect(hours.has(6)).toBe(true);
    expect(hours.has(10)).toBe(true);
    expect(hours.has(11)).toBe(false); // morning ends at 11 exclusive
    expect(hours.has(17)).toBe(true);
    expect(hours.has(21)).toBe(true);
    expect(hours.has(22)).toBe(false); // evening ends at 22 exclusive
    expect(hours.size).toBe(5 + 5);
  });

  it("is empty when the player set no windows for today", () => {
    expect(yourWindowHours(["weekend_morning"], thursday).size).toBe(0);
  });
});

describe("yourWindowSummary", () => {
  it("names today's day and the busiest window, e.g. Thursday-evening", () => {
    const f = forecastWith({ 18: 4, 19: 5 });
    expect(yourWindowSummary(f, ["weekday_evening"], thursday)).toBe(
      "Usually active in your Thursday-evening window",
    );
  });

  it("uses the weekend day name on weekends", () => {
    const f = forecastWith({ 10: 3 });
    expect(yourWindowSummary(f, ["weekend_morning"], saturday)).toBe(
      "Usually active in your Saturday-morning window",
    );
  });

  it("picks the player's most active window when several apply today", () => {
    const f = forecastWith({ 8: 1, 18: 4, 19: 4 });
    expect(yourWindowSummary(f, ["weekday_morning", "weekday_evening"], thursday)).toBe(
      "Usually active in your Thursday-evening window",
    );
  });

  it("is null without a forecast or without history (thin data stays honest)", () => {
    expect(yourWindowSummary(undefined, ["weekday_evening"], thursday)).toBeNull();
    const thin = forecastWith({ 18: 9 }, false);
    expect(yourWindowSummary(thin, ["weekday_evening"], thursday)).toBeNull();
  });

  it("is null when the player set no windows for today", () => {
    const f = forecastWith({ 18: 4 });
    expect(yourWindowSummary(f, [], thursday)).toBeNull();
    expect(yourWindowSummary(f, ["weekend_evening"], thursday)).toBeNull();
  });

  it("is null when the player's windows are historically dead at this court", () => {
    const f = forecastWith({ 2: 6 }); // activity only at 2 AM, outside every window
    expect(yourWindowSummary(f, ["weekday_evening"], thursday)).toBeNull();
  });

  it("ignores today's scheduled runs — 'usually' is history only", () => {
    const f: CourtForecast = {
      ...forecastWith({}),
      sessions: [{ session_id: "s1", hour: 18, starts_at: "x", going: 9 }],
    };
    expect(yourWindowSummary(f, ["weekday_evening"], thursday)).toBeNull();
  });
});
