// Player-confirmable court conditions (Phase 14). Mirrors the server's fact
// allowlist; boolean columns use "yes"/"no" in the confirmations ledger.
import { relativeSince } from "./relative-time";
import type { CourtDetail, CourtFact } from "./types";

export interface CourtFactDef {
  fact: string;
  label: string;
  values: { key: string; label: string }[];
}

const YES_NO = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
];

// The core playing facts, always shown in the conditions section. The rest
// (amenities, policy) only appear when the court already has a value for them
// or behind the "add more details" toggle, so the list stays scannable.
export const CORE_FACTS = new Set(["rim_type", "net_type", "surface", "hoop_count", "lighting"]);

// Ordered physical hardware → surface → amenities → policy. Mirrors the
// server's fact allowlist (server/internal/api/conditions_handlers.go).
export const COURT_FACTS: CourtFactDef[] = [
  {
    fact: "rim_type",
    label: "Rims",
    values: [
      { key: "single", label: "Single" },
      { key: "double", label: "Double" },
    ],
  },
  {
    fact: "net_type",
    label: "Nets",
    values: [
      { key: "chain", label: "Chain" },
      { key: "nylon", label: "Nylon" },
      { key: "none", label: "Bare rim" },
    ],
  },
  {
    fact: "surface",
    label: "Surface",
    values: [
      { key: "asphalt", label: "Asphalt" },
      { key: "concrete", label: "Concrete" },
      { key: "hardwood", label: "Hardwood" },
      { key: "rubber", label: "Rubber" },
      { key: "other", label: "Other" },
    ],
  },
  {
    // A count, so it uses discrete buckets — an off-bucket court (e.g. 3 hoops)
    // matches no chip until players correct it.
    fact: "hoop_count",
    label: "Hoops",
    values: [
      { key: "1", label: "1" },
      { key: "2", label: "2" },
      { key: "4", label: "4" },
      { key: "6", label: "6" },
      { key: "8", label: "8+" },
    ],
  },
  { fact: "lighting", label: "Lights", values: YES_NO },
  { fact: "covered", label: "Covered", values: YES_NO },
  { fact: "fenced", label: "Fenced", values: YES_NO },
  { fact: "drinking_water", label: "Water", values: YES_NO },
  { fact: "toilets", label: "Restrooms", values: YES_NO },
  { fact: "parking", label: "Parking", values: YES_NO },
  {
    fact: "access",
    label: "Access",
    values: [
      { key: "public", label: "Public" },
      { key: "private", label: "Private" },
      { key: "customers", label: "Customers" },
    ],
  },
  { fact: "fee", label: "Fee to play", values: YES_NO },
];

const boolValue = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");

// The court's stored value for a fact, in ledger terms ("yes"/"no"/enum key).
export function courtFactValue(court: CourtDetail, fact: string): string | null {
  switch (fact) {
    case "rim_type":
      return court.rim_type;
    case "net_type":
      return court.net_type;
    case "surface":
      return court.surface;
    case "hoop_count":
      return court.hoop_count == null ? null : String(court.hoop_count);
    case "lighting":
      return boolValue(court.lighting);
    case "covered":
      return boolValue(court.covered);
    case "fenced":
      return boolValue(court.fenced);
    case "drinking_water":
      return boolValue(court.drinking_water);
    case "toilets":
      return boolValue(court.toilets);
    case "parking":
      return boolValue(court.parking);
    case "access":
      return court.access;
    case "fee":
      return boolValue(court.fee);
    default:
      return null;
  }
}

// "Confirmed by 3 · 2w ago" (or null when nobody has confirmed this fact).
export function freshnessLine(
  summary: CourtFact | undefined,
  now: number = Date.now(),
): string | null {
  if (!summary || summary.confirmations === 0) return null;
  const count = summary.confirmations === 1 ? "1 player" : `${summary.confirmations} players`;
  return `Confirmed by ${count} · ${relativeSince(summary.last_confirmed_at, now)}`;
}
