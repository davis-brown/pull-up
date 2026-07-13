// Pure, node-safe: the "now" mode pin sizing decision. No RN imports — this
// must stay usable from CourtMap.tsx, CourtMap.web.tsx, and jest (node env)
// alike. See ./court-filters.ts for the pattern.
export type PinVariant = { kind: "dot" } | { kind: "count"; size: 36 | 52 };

// Selected always gets the big 52px treatment (with the pulsing halo added by
// the caller); an unselected quiet court (no players) shrinks to a dot;
// everything else is a standard 36px count pin.
export function pinVariant(count: number, selected: boolean): PinVariant {
  if (selected) return { kind: "count", size: 52 };
  if (count === 0) return { kind: "dot" };
  return { kind: "count", size: 36 };
}
