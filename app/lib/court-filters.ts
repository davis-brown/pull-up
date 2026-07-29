// Pure and node-safe: court attribute filters and their query-string form.
// Type-only import, so there is no react-native dependency for node-env jest.
import type { CourtSummary, Surface } from "./types";
export type { Surface };

export interface CourtFilters {
  indoor?: boolean;
  lit?: boolean;
  has_hoops?: boolean;
  public?: boolean;
  free?: boolean;
  covered?: boolean;
  water?: boolean;
  toilets?: boolean;
  parking?: boolean;
  fenced?: boolean;
  surface?: Surface;
  min_hoops?: number;
}

const BOOL_KEYS = [
  "indoor",
  "lit",
  "has_hoops",
  "public",
  "free",
  "covered",
  "water",
  "toilets",
  "parking",
  "fenced",
] as const;

// Explicit false values matter for strict filters (the Night run preset's
// indoor=false), so they are preserved rather than treated as unset.
export function filtersToQuery(f: CourtFilters): string {
  let q = "";
  for (const k of BOOL_KEYS) {
    if (f[k] !== undefined) q += `&${k}=${String(f[k])}`;
  }
  if (f.surface) q += `&surface=${f.surface}`;
  if (f.min_hoops) q += `&min_hoops=${f.min_hoops}`;
  return q;
}

// Quick-preset bundles for FilterSheet's "QUICK PRESETS" grid.
export interface FilterPreset {
  key: "night_run" | "serious_run" | "rainy_day" | "shoot_around";
  title: string;
  description: string;
  icon: string; // Ionicons name
  filters: CourtFilters;
}

export const PRESETS: FilterPreset[] = [
  {
    key: "night_run",
    title: "Night run",
    description: "Lit, outdoor courts",
    icon: "moon",
    filters: { lit: true, indoor: false },
  },
  {
    key: "serious_run",
    title: "Serious run",
    description: "4+ hoop courts",
    icon: "trophy",
    filters: { min_hoops: 4 },
  },
  {
    key: "rainy_day",
    title: "Rainy day",
    description: "Indoor courts",
    icon: "rainy",
    filters: { indoor: true },
  },
  {
    key: "shoot_around",
    title: "Shoot around",
    description: "Any court works",
    icon: "basketball",
    filters: {},
  },
];

// Strips `undefined` values so `{ lit: undefined }` compares equal to `{}`:
// chip toggles set a key back to `undefined` rather than deleting it.
function definedEntries(f: CourtFilters): [string, unknown][] {
  return Object.entries(f).filter(([, v]) => v !== undefined);
}

function filtersEqual(a: CourtFilters, b: CourtFilters): boolean {
  const ea = definedEntries(a);
  const eb = definedEntries(b);
  if (ea.length !== eb.length) return false;
  const bMap = new Map(eb);
  return ea.every(([k, v]) => bMap.get(k) === v);
}

// A preset is "active" only on exact equality with its bundle, not a
// subset/superset test — editing any chip clears the highlight.
export function activePreset(f: CourtFilters): FilterPreset["key"] | null {
  return PRESETS.find((p) => filtersEqual(p.filters, f))?.key ?? null;
}

// Client-side predicate mirroring CourtsInBBox in
// server/internal/store/queries/courts.sql, so "SHOW N COURTS" can count
// matches over the loaded viewport without a round trip. Keep the two in
// sync. For the amenity filters a false value is a no-op and a true one fails
// on null; `public` and `free` are tri-state — see below.
export function matchesFilters(c: CourtSummary, f: CourtFilters): boolean {
  if (f.indoor !== undefined && c.indoor !== f.indoor) return false;

  if (f.lit !== undefined) {
    if (c.lighting === null || c.lighting !== f.lit) return false;
  }

  if (f.has_hoops && !(c.hoop_count != null && c.hoop_count > 0)) return false;

  // public/free are tri-state, unlike the amenity filters above: false is not
  // a no-op but the inverse filter, keeping only restricted/pay-to-play
  // courts. Unknown access and fee read as public and free.
  if (f.public !== undefined) {
    const open = c.is_public && (c.access == null || c.access === "public");
    if (open !== f.public) return false;
  }

  if (f.free !== undefined) {
    const free = c.fee == null || c.fee === false;
    if (free !== f.free) return false;
  }

  if (f.covered !== undefined) {
    if (c.covered === null || c.covered !== f.covered) return false;
  }

  if (f.surface !== undefined && c.surface !== f.surface) return false;

  if (f.water && c.drinking_water !== true) return false;
  if (f.toilets && c.toilets !== true) return false;
  if (f.parking && c.parking !== true) return false;
  if (f.fenced && c.fenced !== true) return false;

  if (
    f.min_hoops !== undefined &&
    !(c.hoop_count != null && c.hoop_count >= f.min_hoops)
  ) {
    return false;
  }

  return true;
}
