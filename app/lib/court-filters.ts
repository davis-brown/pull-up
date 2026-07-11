// Pure, node-safe: the active court attribute filters and their query-string form.
export type Surface = "asphalt" | "concrete" | "hardwood" | "rubber" | "other";

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
}

const BOOL_KEYS = ["indoor", "lit", "has_hoops", "public", "free", "covered", "water", "toilets", "parking", "fenced"] as const;

// Only truthy booleans and a set surface become params; everything else is a no-op.
export function filtersToQuery(f: CourtFilters): string {
  let q = "";
  for (const k of BOOL_KEYS) {
    if (f[k]) q += `&${k}=true`;
  }
  if (f.surface) q += `&surface=${f.surface}`;
  return q;
}
