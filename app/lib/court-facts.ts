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
  { fact: "lighting", label: "Lights", values: YES_NO },
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
  { fact: "drinking_water", label: "Water", values: YES_NO },
  { fact: "toilets", label: "Restrooms", values: YES_NO },
];

const boolValue = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");

// The court's stored value for a fact, in ledger terms ("yes"/"no"/enum key).
export function courtFactValue(court: CourtDetail, fact: string): string | null {
  switch (fact) {
    case "rim_type":
      return court.rim_type;
    case "net_type":
      return court.net_type;
    case "lighting":
      return boolValue(court.lighting);
    case "surface":
      return court.surface;
    case "drinking_water":
      return boolValue(court.drinking_water);
    case "toilets":
      return boolValue(court.toilets);
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
