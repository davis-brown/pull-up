import { COURT_FACTS, courtFactValue, freshnessLine } from "./court-facts";
import type { CourtDetail, CourtFact } from "./types";

const court = {
  rim_type: "double",
  net_type: null,
  lighting: true,
  surface: "asphalt",
  drinking_water: false,
  toilets: null,
} as CourtDetail;

describe("courtFactValue", () => {
  it("maps enum and boolean columns to ledger values", () => {
    expect(courtFactValue(court, "rim_type")).toBe("double");
    expect(courtFactValue(court, "net_type")).toBeNull();
    expect(courtFactValue(court, "lighting")).toBe("yes");
    expect(courtFactValue(court, "drinking_water")).toBe("no");
    expect(courtFactValue(court, "toilets")).toBeNull();
    expect(courtFactValue(court, "surface")).toBe("asphalt");
  });
});

describe("freshnessLine", () => {
  const now = new Date("2026-07-10T18:30:00Z").getTime();
  it("formats count and recency", () => {
    const summary: CourtFact = {
      fact: "rim_type",
      confirmations: 3,
      last_confirmed_at: "2026-07-08T18:30:00Z",
      majority_value: "double",
    };
    expect(freshnessLine(summary, now)).toBe("Confirmed by 3 players · 2d ago");
    expect(freshnessLine({ ...summary, confirmations: 1 }, now)).toBe(
      "Confirmed by 1 player · 2d ago",
    );
    expect(freshnessLine(undefined, now)).toBeNull();
  });
});

describe("COURT_FACTS", () => {
  it("covers every fact courtFactValue understands", () => {
    for (const def of COURT_FACTS) {
      expect(courtFactValue(court, def.fact)).not.toBe(undefined);
      expect(def.values.length).toBeGreaterThan(1);
    }
  });
});
