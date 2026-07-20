import {
  dayLabel,
  dayOffsetFromToday,
  groupRunIntents,
  intentDayOptions,
  windowsForDate,
} from "./run-intents";
import type { RunIntentSeeker } from "./types";

// Jul 16 2026 is a Thursday (noon UTC, away from any date-boundary edge
// case); Jul 18 is the following Saturday.
const now = new Date("2026-07-16T12:00:00Z");

function seeker(overrides: Partial<RunIntentSeeker>): RunIntentSeeker {
  return {
    run_date: "2026-07-16",
    window_key: "weekday_evening",
    user_id: "u1",
    display_name: "Player",
    avatar_url: null,
    skill_level: null,
    ...overrides,
  };
}

describe("intentDayOptions", () => {
  it("returns today through +7 days, labeled Today/Tomorrow/weekday", () => {
    const opts = intentDayOptions(now);
    expect(opts).toHaveLength(8);
    expect(opts[0]).toMatchObject({ iso: "2026-07-16", label: "Today", dayType: "weekday" });
    expect(opts[1]).toMatchObject({ iso: "2026-07-17", label: "Tomorrow", dayType: "weekday" });
    // Saturday the 18th, two days out.
    expect(opts[2].iso).toBe("2026-07-18");
    expect(opts[2].dayType).toBe("weekend");
    expect(opts[2].label).not.toBe("Today");
    expect(opts[2].label).not.toBe("Tomorrow");
    // Last option is exactly +7 days.
    expect(opts[7].iso).toBe("2026-07-23");
  });
});

describe("windowsForDate", () => {
  it("returns weekday windows for a weekday", () => {
    expect(windowsForDate("2026-07-16").map((w) => w.key)).toEqual([
      "weekday_morning",
      "weekday_lunch",
      "weekday_evening",
    ]);
  });

  it("returns weekend windows for a weekend date", () => {
    expect(windowsForDate("2026-07-18").map((w) => w.key)).toEqual([
      "weekend_morning",
      "weekend_afternoon",
      "weekend_evening",
    ]);
  });
});

describe("dayOffsetFromToday", () => {
  it("computes the day count between a bucket date and now", () => {
    expect(dayOffsetFromToday("2026-07-18", now)).toBe(2);
    expect(dayOffsetFromToday("2026-07-16", now)).toBe(0);
  });

  it("clamps to [0, 7] for out-of-range dates", () => {
    expect(dayOffsetFromToday("2026-07-01", now)).toBe(0); // past
    expect(dayOffsetFromToday("2026-09-01", now)).toBe(7); // far future
  });
});

describe("dayLabel", () => {
  it("labels today, tomorrow, and later dates", () => {
    expect(dayLabel("2026-07-16", now)).toBe("Today");
    expect(dayLabel("2026-07-17", now)).toBe("Tomorrow");
    expect(dayLabel("2026-07-18", now)).toContain("Sat");
  });
});

describe("groupRunIntents", () => {
  it("groups seekers into buckets labeled with day + window", () => {
    const seekers = [
      seeker({ user_id: "a", display_name: "Marcus", skill_level: "intermediate" }),
      seeker({ user_id: "b", display_name: "Sam" }),
    ];
    const buckets = groupRunIntents(seekers, now);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      run_date: "2026-07-16",
      window_key: "weekday_evening",
      label: "Today evening",
    });
    expect(buckets[0].seekers).toHaveLength(2);
  });

  it("orders buckets by date, then by the window's natural hour order", () => {
    const seekers = [
      seeker({ run_date: "2026-07-16", window_key: "weekday_evening", user_id: "a" }),
      seeker({ run_date: "2026-07-16", window_key: "weekday_lunch", user_id: "b" }),
      seeker({ run_date: "2026-07-17", window_key: "weekday_morning", user_id: "c" }),
    ];
    const buckets = groupRunIntents(seekers, now);
    expect(buckets.map((b) => `${b.run_date}|${b.window_key}`)).toEqual([
      "2026-07-16|weekday_lunch",
      "2026-07-16|weekday_evening",
      "2026-07-17|weekday_morning",
    ]);
  });

  it("returns nothing for an empty seeker list", () => {
    expect(groupRunIntents([], now)).toEqual([]);
  });
});
