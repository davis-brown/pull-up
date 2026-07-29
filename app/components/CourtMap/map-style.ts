import { useEffect, useState } from "react";
import { mapStyleURL } from "./types";

// Renders the map as a flat, violet-tinted "paper" surface rather than
// positron's neutral gray. Instead of hand-authoring a MapLibre style, this
// fetches OpenFreeMap's positron/dark style and recolors it. Recoloring keys
// off layer id + source-layer heuristics; on failure it falls back to the
// untinted style URL, which is still a valid map.

interface MapLayer {
  id?: string;
  type: string;
  "source-layer"?: string;
  paint?: Record<string, unknown>;
}
type MapStyle = Record<string, unknown> & { layers: MapLayer[] };

interface Tint {
  base: string; // land / background
  street: string; // roads — lighter than base so they read as streets
  park: string; // parks and other greenery
  water: string;
  building: string;
}

const LIGHT: Tint = {
  base: "#E7E6F1",
  street: "#F4F3FB",
  park: "#DCE6CC",
  water: "#D3D6EC",
  building: "#DEDCEC",
};
const DARK: Tint = {
  base: "#1B1830",
  street: "#26233B",
  park: "#1E2A22",
  water: "#141122",
  building: "#221F38",
};

const PARK_RE = /park|wood|grass|forest|golf|pitch|meadow|scrub|cemetery|garden|recreation|greens?/;
const WATER_RE = /water|ocean|sea|lake|river|bay/;
const ROAD_RE = /road|street|motorway|highway|trunk|primary|secondary|tertiary|bridge|tunnel|transit|rail|path|track/;

// Returns a deep copy. Only park-like layers go green; general landuse is
// left to the base color so cities don't render as fields.
function tint(style: MapStyle, c: Tint): MapStyle {
  const clone: MapStyle = JSON.parse(JSON.stringify(style));
  for (const layer of clone.layers) {
    const id = (layer.id ?? "").toLowerCase();
    const sl = layer["source-layer"];
    const set = (prop: string, value: string) => {
      layer.paint = { ...(layer.paint ?? {}), [prop]: value };
    };
    if (layer.type === "background") {
      set("background-color", c.base);
    } else if (sl === "water" || sl === "waterway" || WATER_RE.test(id)) {
      if (layer.type === "fill") set("fill-color", c.water);
      else if (layer.type === "line") set("line-color", c.water);
    } else if (PARK_RE.test(id)) {
      if (layer.type === "fill") set("fill-color", c.park);
    } else if ((sl === "transportation" || ROAD_RE.test(id)) && layer.type === "line") {
      set("line-color", c.street);
    } else if (sl === "building" || id === "building") {
      if (layer.type === "fill") set("fill-color", c.building);
    }
  }
  return clone;
}

// Module-level cache: fetch + tint each scheme's style at most once per session.
const cache = new Map<string, MapStyle>();

// Returns the tinted style object, falling back to the plain positron/dark
// URL until the fetch+tint resolves. The cache is read during render, so only
// the first load of each scheme flashes neutral.
export function useMapStyle(scheme: "light" | "dark"): MapStyle | string {
  const [, bump] = useState(0);
  useEffect(() => {
    if (cache.has(scheme)) return;
    let cancelled = false;
    void fetch(mapStyleURL(scheme))
      .then((r) => r.json())
      .then((raw: MapStyle) => {
        if (cancelled) return;
        cache.set(scheme, tint(raw, scheme === "dark" ? DARK : LIGHT));
        bump((n) => n + 1);
      })
      .catch(() => {
        // Keep the URL fallback — an untinted map beats no map.
      });
    return () => {
      cancelled = true;
    };
  }, [scheme]);
  return cache.get(scheme) ?? mapStyleURL(scheme);
}
