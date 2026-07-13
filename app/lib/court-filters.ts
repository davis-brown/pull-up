// Pure, node-safe: the active court attribute filters and their query-string form.
// Surface is the single source of truth in ./types (type-only import — no
// react-native runtime dependency, safe for node-env jest).
import type { Surface } from "./types";
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

const BOOL_KEYS = ["indoor", "lit", "has_hoops", "public", "free", "covered", "water", "toilets", "parking", "fenced"] as const;

// Only truthy booleans and a set surface become params; everything else is a no-op.
export function filtersToQuery(f: CourtFilters): string {
  let q = "";
  for (const k of BOOL_KEYS) {
    if (f[k]) q += `&${k}=true`;
  }
  if (f.surface) q += `&surface=${f.surface}`;
  if (f.min_hoops) q += `&min_hoops=${f.min_hoops}`;
  return q;
}
