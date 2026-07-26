import {
  busiestWindow,
  expectedAt,
  forecastIdSet,
  lowConfidenceLabel,
  scrubHours,
  sessionAt,
  type CourtForecast,
} from "./forecast";

const forecast: CourtForecast = {
  court_id: "court-1",
  hours: Array.from({ length: 24 }, (_, h) => (h === 18 ? 4 : 0)),
  has_history: true,
  weeks: 8,
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

describe("lowConfidenceLabel", () => {
  it("caveats a thin forecast and stays quiet on a well-backed or empty one", () => {
    expect(lowConfidenceLabel({ ...forecast, weeks: 2 })).toBe("Based on 2 weeks of check-ins");
    expect(lowConfidenceLabel({ ...forecast, weeks: 1 })).toBe("Based on 1 week of check-ins");
    // Enough weeks to stand on its own → no caveat.
    expect(lowConfidenceLabel({ ...forecast, weeks: 4 })).toBeNull();
    expect(lowConfidenceLabel({ ...forecast, weeks: 8 })).toBeNull();
    // No history, or no forecast at all → nothing to caveat.
    expect(lowConfidenceLabel({ ...forecast, has_history: false, weeks: 0 })).toBeNull();
    expect(lowConfidenceLabel(undefined)).toBeNull();
    // Defensive: has_history but a 0 week count still reads as at least 1.
    expect(lowConfidenceLabel({ ...forecast, weeks: 0 })).toBe("Based on 1 week of check-ins");
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

describe("forecastIdSet", () => {
  it("dedupes and sorts when under the cap", () => {
    expect(forecastIdSet(["b", "a", "b", "c"], null, 50)).toEqual(["a", "b", "c"]);
  });

  it("caps at the given size, keeping the lexicographically-first ids", () => {
    const ids = ["c", "a", "b"];
    expect(forecastIdSet(ids, null, 2)).toEqual(["a", "b"]);
  });

  it("always includes priorityId even when it would sort outside the cap", () => {
    // "z-court" sorts last, so a naive sort-then-slice(0, 2) would drop it.
    const ids = ["a-court", "b-court", "z-court"];
    expect(forecastIdSet(ids, "z-court", 2)).toEqual(["a-court", "z-court"]);
  });

  it("adds priorityId to the set even when it isn't already in ids", () => {
    expect(forecastIdSet(["a", "b"], "z", 50)).toEqual(["a", "b", "z"]);
  });

  it("is a no-op cap-wise when priorityId is null", () => {
    expect(forecastIdSet(["b", "a"], null, 50)).toEqual(["a", "b"]);
  });

  it("produces a deterministic (sorted) result regardless of input order or priorityId", () => {
    const a = forecastIdSet(["c", "a", "b"], "b", 50);
    const b = forecastIdSet(["a", "b", "c"], null, 50);
    expect(a).toEqual(["a", "b", "c"]);
    expect(b).toEqual(["a", "b", "c"]);
  });

  it("doesn't duplicate priorityId when it's already within the cap", () => {
    expect(forecastIdSet(["a", "b", "c"], "a", 2)).toEqual(["a", "b"]);
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
