// Pure, node-safe: the active court attribute filters and their query-string form.
// Surface is the single source of truth in ./types (type-only import — no
// react-native runtime dependency, safe for node-env jest).
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

// Explicit false values matter for strict filters (notably the Night run
// preset's indoor=false), so preserve them rather than treating them as unset.
export function filtersToQuery(f: CourtFilters): string {
  let q = "";
  for (const k of BOOL_KEYS) {
    if (f[k] !== undefined) q += `&${k}=${String(f[k])}`;
  }
  if (f.surface) q += `&surface=${f.surface}`;
  if (f.min_hoops) q += `&min_hoops=${f.min_hoops}`;
  return q;
}

// Quick-preset bundles surfaced in FilterSheet's "QUICK PRESETS" grid. A
// preset is just a canned CourtFilters value — selecting one sets the draft
// filters wholesale, but every chip stays individually editable afterward
// (see activePreset below for the highlight-deselect rule).
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

// Strips keys whose value is `undefined` so `{ lit: undefined }` compares
// equal to `{}` — chip toggles set the key back to `undefined` rather than
// deleting it, so equality must treat the two as the same filter state.
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

// A preset is "active" only when the current filters exactly equal one of
// the preset bundles — editing any chip so the set diverges from the bundle
// (adding, removing, or flipping a value) clears the highlight. This is a
// simple exact-equality check, not a subset/superset test.
export function activePreset(f: CourtFilters): FilterPreset["key"] | null {
  return PRESETS.find((p) => filtersEqual(p.filters, f))?.key ?? null;
}

// Client-side predicate mirroring server/internal/store/queries/courts.sql
// (CourtsInBBox) so "SHOW N COURTS" can count matches over the
// already-loaded viewport without a round trip. Each rule below is commented
// with the SQL line it mirrors.
export function matchesFilters(c: CourtSummary, f: CourtFilters): boolean {
  // `(narg('indoor') IS NULL OR c.indoor = narg('indoor'))` — strict equality.
  // `indoor` is non-null on CourtSummary, so there's no unknown case here.
  if (f.indoor !== undefined && c.indoor !== f.indoor) return false;

  // `(narg('lit') IS NULL OR c.lighting = narg('lit'))` — strict equality;
  // a positive requirement fails when lighting is unknown (null).
  if (f.lit !== undefined) {
    if (c.lighting === null || c.lighting !== f.lit) return false;
  }

  // `(narg('has_hoops') IS NULL OR narg=false OR c.hoop_count > 0)` —
  // false is a no-op; a true requirement fails on a null/zero hoop_count.
  if (f.has_hoops && !(c.hoop_count != null && c.hoop_count > 0)) return false;

  // `(narg('public') IS NULL OR narg=false OR (c.is_public = true AND
  //   (c.access IS NULL OR c.access = 'public')))` — false is a no-op; true
  // requires is_public AND (access is null or 'public').
  if (f.public && !(c.is_public && (c.access == null || c.access === "public")))
    return false;

  // `(narg('free') IS NULL OR narg=false OR c.fee IS NULL OR c.fee = false)`
  // — false is a no-op; a true requirement passes when fee is null or false.
  if (f.free && !(c.fee == null || c.fee === false)) return false;

  // `(narg('covered') IS NULL OR c.covered = narg('covered'))` — strict
  // equality; a positive requirement fails when covered is null.
  if (f.covered !== undefined) {
    if (c.covered === null || c.covered !== f.covered) return false;
  }

  // `(narg('surface') IS NULL OR c.surface = narg('surface'))` — strict
  // equality; a positive requirement fails when surface is null.
  if (f.surface !== undefined && c.surface !== f.surface) return false;

  // `(narg('water') IS NULL OR narg=false OR c.drinking_water = true)`
  if (f.water && c.drinking_water !== true) return false;
  // `(narg('toilets') IS NULL OR narg=false OR c.toilets = true)`
  if (f.toilets && c.toilets !== true) return false;
  // `(narg('parking') IS NULL OR narg=false OR c.parking = true)`
  if (f.parking && c.parking !== true) return false;
  // `(narg('fenced') IS NULL OR narg=false OR c.fenced = true)`
  if (f.fenced && c.fenced !== true) return false;

  // `(narg('min_hoops') IS NULL OR c.hoop_count >= narg('min_hoops'))` —
  // a null hoop_count fails a positive requirement.
  if (
    f.min_hoops !== undefined &&
    !(c.hoop_count != null && c.hoop_count >= f.min_hoops)
  ) {
    return false;
  }

  return true;
}
