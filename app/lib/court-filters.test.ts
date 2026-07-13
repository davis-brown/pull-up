import {
  activePreset,
  filtersToQuery,
  matchesFilters,
  PRESETS,
  type CourtFilters,
} from "./court-filters";
import type { CourtSummary } from "./types";

describe("filtersToQuery", () => {
  it("omits unset filters", () => {
    expect(filtersToQuery({})).toBe("");
  });
  it("serializes active boolean + surface filters", () => {
    const f: CourtFilters = { lit: true, has_hoops: true, surface: "asphalt" };
    expect(filtersToQuery(f)).toBe("&lit=true&has_hoops=true&surface=asphalt");
  });
  it("drops false booleans (no-op filters)", () => {
    expect(filtersToQuery({ lit: false })).toBe("");
  });
  it("serializes min_hoops when set", () => {
    expect(filtersToQuery({ min_hoops: 4 })).toBe("&min_hoops=4");
  });
  it("omits min_hoops when 0 or unset", () => {
    expect(filtersToQuery({ min_hoops: 0 })).toBe("");
    expect(filtersToQuery({})).toBe("");
  });
});

// Minimal CourtSummary fixture builder — only the fields matchesFilters reads
// vary per call; the rest are filler to satisfy the type.
function makeCourt(overrides: Partial<CourtSummary>): CourtSummary {
  return {
    id: "c1",
    name: "Test Court",
    lat: 0,
    lng: 0,
    address: null,
    hoop_count: 2,
    indoor: false,
    surface: "asphalt",
    lighting: true,
    is_public: true,
    drinking_water: null,
    toilets: null,
    parking: null,
    fenced: null,
    source: "osm",
    status: "verified",
    active_count: 0,
    latest_report: null,
    ...overrides,
  };
}

describe("PRESETS", () => {
  it("defines the four expected presets with their bundles", () => {
    const byKey = Object.fromEntries(PRESETS.map((p) => [p.key, p]));
    expect(byKey.night_run.filters).toEqual({ lit: true, indoor: false });
    expect(byKey.night_run.icon).toBe("moon");
    expect(byKey.serious_run.filters).toEqual({ min_hoops: 4 });
    expect(byKey.serious_run.icon).toBe("trophy");
    expect(byKey.rainy_day.filters).toEqual({ indoor: true });
    expect(byKey.rainy_day.icon).toBe("rainy");
    expect(byKey.shoot_around.filters).toEqual({});
    expect(byKey.shoot_around.icon).toBe("basketball");
  });
});

describe("activePreset", () => {
  it("round-trips every preset's own filter bundle to its key", () => {
    for (const preset of PRESETS) {
      expect(activePreset(preset.filters)).toBe(preset.key);
    }
  });

  it("returns null once chips are edited so the set no longer equals any preset bundle", () => {
    const diverged: CourtFilters = {
      lit: true,
      indoor: false,
      has_hoops: true,
    };
    expect(activePreset(diverged)).toBeNull();
  });

  it("treats explicit undefined keys as absent (equal to {})", () => {
    expect(activePreset({ lit: undefined })).toBe("shoot_around");
  });
});

describe("matchesFilters", () => {
  it("passes everything when no filters are set", () => {
    const c = makeCourt({});
    expect(matchesFilters(c, {})).toBe(true);
  });

  it("a lit court passes {lit: true}", () => {
    const c = makeCourt({ lighting: true });
    expect(matchesFilters(c, { lit: true })).toBe(true);
  });

  it("a court with unknown (null) lighting fails {lit: true}", () => {
    const c = makeCourt({ lighting: null });
    expect(matchesFilters(c, { lit: true })).toBe(false);
  });

  it("a court with lighting=false fails {lit: true}", () => {
    const c = makeCourt({ lighting: false });
    expect(matchesFilters(c, { lit: true })).toBe(false);
  });

  it("indoor is a strict equality check", () => {
    expect(matchesFilters(makeCourt({ indoor: true }), { indoor: true })).toBe(
      true,
    );
    expect(matchesFilters(makeCourt({ indoor: false }), { indoor: true })).toBe(
      false,
    );
    expect(matchesFilters(makeCourt({ indoor: true }), { indoor: false })).toBe(
      false,
    );
  });

  it("surface is a strict equality check; null surface fails a positive requirement", () => {
    expect(
      matchesFilters(makeCourt({ surface: "concrete" }), {
        surface: "concrete",
      }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ surface: "asphalt" }), {
        surface: "concrete",
      }),
    ).toBe(false);
    expect(
      matchesFilters(makeCourt({ surface: null }), { surface: "concrete" }),
    ).toBe(false);
  });

  it("min_hoops requires hoop_count >= min_hoops; null hoop_count fails", () => {
    expect(matchesFilters(makeCourt({ hoop_count: 4 }), { min_hoops: 4 })).toBe(
      true,
    );
    expect(matchesFilters(makeCourt({ hoop_count: 3 }), { min_hoops: 4 })).toBe(
      false,
    );
    expect(
      matchesFilters(makeCourt({ hoop_count: null }), { min_hoops: 4 }),
    ).toBe(false);
  });

  it("has_hoops: false is a no-op; true requires a positive hoop_count", () => {
    expect(
      matchesFilters(makeCourt({ hoop_count: 0 }), { has_hoops: false }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ hoop_count: 1 }), { has_hoops: true }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ hoop_count: 0 }), { has_hoops: true }),
    ).toBe(false);
    expect(
      matchesFilters(makeCourt({ hoop_count: null }), { has_hoops: true }),
    ).toBe(false);
  });

  it("public: false is a no-op; true requires is_public", () => {
    expect(
      matchesFilters(makeCourt({ is_public: false }), { public: false }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ is_public: true }), { public: true }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ is_public: false }), { public: true }),
    ).toBe(false);
  });

  it("free is a client-side no-op (fee isn't present on CourtSummary, mirroring the fee-IS-NULL branch)", () => {
    expect(matchesFilters(makeCourt({}), { free: true })).toBe(true);
  });

  it("covered always fails a positive requirement (covered isn't present on CourtSummary, so it's always unknown)", () => {
    expect(matchesFilters(makeCourt({}), { covered: true })).toBe(false);
    expect(matchesFilters(makeCourt({}), { covered: false })).toBe(true);
  });

  it("water/toilets/parking/fenced: false is a no-op; true requires the attribute === true", () => {
    expect(
      matchesFilters(makeCourt({ drinking_water: null }), { water: true }),
    ).toBe(false);
    expect(
      matchesFilters(makeCourt({ drinking_water: true }), { water: true }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ toilets: null }), { toilets: true }),
    ).toBe(false);
    expect(
      matchesFilters(makeCourt({ toilets: true }), { toilets: true }),
    ).toBe(true);
    expect(
      matchesFilters(makeCourt({ parking: null }), { parking: true }),
    ).toBe(false);
    expect(
      matchesFilters(makeCourt({ parking: true }), { parking: true }),
    ).toBe(true);
    expect(matchesFilters(makeCourt({ fenced: null }), { fenced: true })).toBe(
      false,
    );
    expect(matchesFilters(makeCourt({ fenced: true }), { fenced: true })).toBe(
      true,
    );
  });

  it("night_run preset ({lit: true, indoor: false}) matches 5 of 8 fixture courts", () => {
    const courts: CourtSummary[] = [
      makeCourt({ id: "1", lighting: true, indoor: false }), // match
      makeCourt({ id: "2", lighting: true, indoor: false }), // match
      makeCourt({ id: "3", lighting: true, indoor: false }), // match
      makeCourt({ id: "4", lighting: true, indoor: false }), // match
      makeCourt({ id: "5", lighting: true, indoor: false }), // match
      makeCourt({ id: "6", lighting: false, indoor: false }), // lit fails
      makeCourt({ id: "7", lighting: null, indoor: false }), // lit fails (unknown)
      makeCourt({ id: "8", lighting: true, indoor: true }), // indoor fails
    ];
    const nightRun = PRESETS.find((p) => p.key === "night_run")!;
    expect(
      courts.filter((c) => matchesFilters(c, nightRun.filters)).length,
    ).toBe(5);
  });
});
