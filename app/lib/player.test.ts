import { BADGES, STYLE_TAGS, availabilityLine, formatHeight, playerSubline } from "./player";

describe("formatHeight", () => {
  it("rounds to the nearest inch", () => {
    expect(formatHeight(185)).toBe("6'1\"");
  });

  it("returns null for null input", () => {
    expect(formatHeight(null)).toBeNull();
  });

  it("rounds down when closer to the lower inch", () => {
    // 180cm = 70.866in -> rounds to 71in = 5'11"
    expect(formatHeight(180)).toBe("5'11\"");
  });

  it("handles an exact-foot height", () => {
    // 183cm = 72.0in (183 / 2.54 = 72.0) -> 6'0"
    expect(formatHeight(183)).toBe("6'0\"");
  });
});

describe("playerSubline", () => {
  it("joins jersey number, position, and height with middot separators", () => {
    expect(
      playerSubline({ jersey_number: 23, position: "guard", height_cm: 185 }),
    ).toBe("#23 · Guard · 6'1\"");
  });

  it("capitalizes the position", () => {
    expect(
      playerSubline({ jersey_number: null, position: "forward", height_cm: null }),
    ).toBe("Forward");
  });

  it("omits missing parts without a dangling separator", () => {
    expect(
      playerSubline({ jersey_number: 23, position: null, height_cm: null }),
    ).toBe("#23");
  });

  it("returns an empty string when everything is missing", () => {
    expect(
      playerSubline({ jersey_number: null, position: null, height_cm: null }),
    ).toBe("");
  });

  it("includes jersey and height but omits a missing position", () => {
    expect(
      playerSubline({ jersey_number: 7, position: null, height_cm: 198 }),
    ).toBe("#7 · 6'6\"");
  });
});

describe("STYLE_TAGS", () => {
  it("maps every known key to a human label", () => {
    const byKey = Object.fromEntries(STYLE_TAGS.map((t) => [t.key, t.label]));
    expect(byKey).toEqual({
      shooter: "Shooter",
      pass_first: "Pass-first",
      defense: "Defense",
      rim_runner: "Rim runner",
      casual: "Casual",
      competitive: "Competitive",
    });
  });
});

describe("BADGES", () => {
  it("maps every badge id to a label and icon", () => {
    expect(BADGES).toEqual([
      { id: "first_run", label: "First Run", icon: "basketball" },
      { id: "explorer", label: "Explorer", icon: "map" },
      { id: "early_bird", label: "Early Bird", icon: "sunny" },
      { id: "regular", label: "Regular", icon: "home" },
      { id: "streak_4", label: "On a Streak", icon: "flame" },
      { id: "host", label: "Host", icon: "people" },
    ]);
  });
});

describe("playerSubline with skill level", () => {
  it("appends the capitalized skill level", () => {
    expect(
      playerSubline({ jersey_number: 23, position: "guard", height_cm: 185, skill_level: "advanced" }),
    ).toBe("#23 · Guard · 6'1\" · Advanced");
  });

  it("omits a null skill level", () => {
    expect(
      playerSubline({ jersey_number: null, position: null, height_cm: null, skill_level: null }),
    ).toBe("");
  });
});

describe("availabilityLine", () => {
  it("joins window labels with middots", () => {
    expect(availabilityLine(["weekday_evening", "weekend_morning"])).toBe(
      "Weekday evenings · Weekend mornings",
    );
  });

  it("skips unknown keys and returns empty for none", () => {
    expect(availabilityLine(["not_a_window"])).toBe("");
    expect(availabilityLine([])).toBe("");
  });
});
