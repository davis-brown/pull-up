import {
  busiestWindow,
  expectedAt,
  scrubHours,
  sessionAt,
  type CourtForecast,
} from "./forecast";

const forecast: CourtForecast = {
  court_id: "court-1",
  hours: Array.from({ length: 24 }, (_, h) => (h === 18 ? 4 : 0)),
  has_history: true,
  sessions: [
    { session_id: "s1", hour: 18, starts_at: "2026-07-12T18:00:00Z", going: 3 },
    { session_id: "s2", hour: 20, starts_at: "2026-07-12T20:00:00Z", going: 2 },
  ],
};

describe("expectedAt", () => {
  it("sums the hourly forecast with going counts of sessions at that hour", () => {
    // hours[18] = 4, plus session s1's going=3 => 7
    expect(expectedAt(forecast, 18)).toBe(7);
  });

  it("adds multiple sessions' going counts at the same hour", () => {
    const f: CourtForecast = {
      ...forecast,
      sessions: [
        { session_id: "s1", hour: 9, starts_at: "x", going: 2 },
        { session_id: "s2", hour: 9, starts_at: "x", going: 5 },
      ],
    };
    expect(expectedAt(f, 9)).toBe(2 + 5);
  });

  it("falls back to just the hourly forecast when no sessions match", () => {
    expect(expectedAt(forecast, 20)).toBe(forecast.hours[20] + 2);
    expect(expectedAt(forecast, 3)).toBe(0);
  });

  it("returns 0 when forecast is undefined", () => {
    expect(expectedAt(undefined, 12)).toBe(0);
  });
});

describe("sessionAt", () => {
  it("returns the session scheduled at the given hour", () => {
    expect(sessionAt(forecast, 18)?.session_id).toBe("s1");
  });

  it("returns null when no session matches the hour", () => {
    expect(sessionAt(forecast, 5)).toBeNull();
  });

  it("returns null when forecast is undefined", () => {
    expect(sessionAt(undefined, 18)).toBeNull();
  });
});

describe("busiestWindow", () => {
  it("picks the peaked 3-hour window (5-8 PM shape)", () => {
    const hours = Array(24).fill(0);
    hours[17] = 2;
    hours[18] = 10;
    hours[19] = 8;
    hours[20] = 1;
    // Best 3-hour sliding window sum: hours[18..20] = 10+8+1=19 vs hours[17..19]=2+10+8=20
    const win = busiestWindow(hours);
    expect(win).toEqual({ start: 17, end: 19 });
  });

  it("returns null when every hour is zero", () => {
    expect(busiestWindow(Array(24).fill(0))).toBeNull();
  });
});

describe("scrubHours", () => {
  it("returns currentHour..closeHour (default 22 / 10 PM)", () => {
    const now = new Date(2026, 6, 12, 14, 30); // 2:30 PM local
    expect(scrubHours(now)).toEqual([14, 15, 16, 17, 18, 19, 20, 21, 22]);
  });

  it("respects a custom closeHour", () => {
    const now = new Date(2026, 6, 12, 20, 0);
    expect(scrubHours(now, 23)).toEqual([20, 21, 22, 23]);
  });

  it("clamps to a non-empty range even late at night (11 PM)", () => {
    const now = new Date(2026, 6, 12, 23, 0);
    expect(scrubHours(now).length).toBeGreaterThan(0);
    expect(scrubHours(now)[0]).toBe(23);
  });

  it("clamps to a non-empty range when current hour is past closeHour", () => {
    const now = new Date(2026, 6, 12, 23, 0);
    expect(scrubHours(now, 22)).toEqual([23]);
  });
});
