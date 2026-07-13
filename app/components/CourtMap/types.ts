import type { BBox } from "@/lib/hooks";

export interface CourtPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  activeCount: number;
  status: "pending" | "verified" | "rejected";
  /** "Now" mode's activity weight for this pin (mapped from active_count for
   * now; a later task swaps in scrubbed forecasts). Falls back to
   * activeCount when omitted. */
  expectedCount?: number;
  selected?: boolean;
}

export interface LatLng {
  lat: number;
  lng: number;
}

// Shared contract between CourtMap.tsx (native, @maplibre/maplibre-react-native)
// and CourtMap.web.tsx (react-map-gl/maplibre). Everything above this component
// is platform-agnostic — keep the two implementations honoring the same props.
export interface CourtMapProps {
  courts: CourtPin[];
  initialCenter: LatLng;
  initialZoom?: number;
  /** Fired (debounced by the map's own idle event) when the viewport settles. */
  onRegionChange?: (bbox: BBox) => void;
  onPinPress?: (courtId: string) => void;
  /** Show the OS blue-dot user location. */
  showUserLocation?: boolean;
  /** "now" weights pins by expectedCount and shrinks quiet courts to dots;
   * "all" gives every court the equal-weight marker look. */
  mode: "now" | "all";
  selectedCourtId?: string | null;
  style?: object;
}

// OpenFreeMap: free OSM-based vector tiles, no API key, no usage cap.
// Attribution (© OpenStreetMap contributors) comes from the style itself —
// keep the map's attribution control visible.
export function mapStyleURL(scheme: "light" | "dark"): string {
  return scheme === "dark"
    ? "https://tiles.openfreemap.org/styles/dark"
    : "https://tiles.openfreemap.org/styles/positron";
}
