import { filtersToQuery, type CourtFilters } from "./court-filters";

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
