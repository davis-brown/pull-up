import { CORE_FACTS, COURT_FACTS, courtFactValue, freshnessLine } from "./court-facts";
import type { CourtDetail, CourtFact } from "./types";

const court = {
  rim_type: "double",
  net_type: null,
  lighting: true,
  surface: "asphalt",
  hoop_count: 4,
  covered: false,
  fenced: null,
  drinking_water: false,
  toilets: null,
  parking: true,
  access: "private",
  fee: null,
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

  it("maps the newly confirmable attributes", () => {
    // hoop_count is a count rendered as its bucket key.
    expect(courtFactValue(court, "hoop_count")).toBe("4");
    expect(courtFactValue({ ...court, hoop_count: null } as CourtDetail, "hoop_count")).toBeNull();
    expect(courtFactValue(court, "covered")).toBe("no");
    expect(courtFactValue(court, "fenced")).toBeNull();
    expect(courtFactValue(court, "parking")).toBe("yes");
    expect(courtFactValue(court, "access")).toBe("private");
    expect(courtFactValue(court, "fee")).toBeNull();
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

  it("only marks real facts as core", () => {
    const known = new Set(COURT_FACTS.map((d) => d.fact));
    for (const fact of CORE_FACTS) {
      expect(known.has(fact)).toBe(true);
    }
  });
});
