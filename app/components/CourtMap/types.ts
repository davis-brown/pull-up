import type { BBox } from "@/lib/hooks";

export interface CourtPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  activeCount: number;
  status: "pending" | "verified" | "rejected";
  /** "Now" mode's activity weight. Falls back to activeCount when omitted. */
  expectedCount?: number;
  selected?: boolean;
  /** ISO start of the earliest run in the next 24h; drives the pin's tick. */
  nextRunAt?: string | null;
  /** Pay-to-play; draws a $ badge so cost reads without opening the court. */
  paid?: boolean;
  /** Private or customers-only; draws a lock badge. Paid wins when both. */
  restricted?: boolean;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type CameraTarget =
  | { key: number; kind: "center"; center: LatLng; zoom?: number }
  | { key: number; kind: "bounds"; bbox: BBox };

// Shared contract between CourtMap.tsx (native) and CourtMap.web.tsx. Keep
// both implementations honoring the same props.
export interface CourtMapProps {
  courts: CourtPin[];
  initialCenter: LatLng;
  initialZoom?: number;
  /** Explicit post-mount camera movement, used by discovery search results. */
  cameraTarget?: CameraTarget | null;
  /** Fired (debounced by the map's own idle event) when the viewport settles. */
  onRegionChange?: (bbox: BBox) => void;
  onPinPress?: (courtId: string) => void;
  /** Show the OS blue-dot user location. */
  showUserLocation?: boolean;
  /** "now" weights pins by expectedCount and shrinks quiet courts to dots;
   * "all" gives every court the equal-weight marker look. */
  mode: "now" | "all";
  selectedCourtId?: string | null;
  /** Desktop web only: the court hovered in the side panel, raised to a 36px
   * pin even when quiet. Ignored by the native map. */
  hoveredCourtId?: string | null;
  /** Web only: which map corner gets the attribution ⓘ, so it clears the
   * mobile Add-court FAB. Ignored by the native map. */
  attributionPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  style?: object;
}

// OpenFreeMap: free OSM-based vector tiles, no API key. Attribution comes
// from the style itself, so keep the map's attribution control visible.
export function mapStyleURL(scheme: "light" | "dark"): string {
  return scheme === "dark"
    ? "https://tiles.openfreemap.org/styles/dark"
    : "https://tiles.openfreemap.org/styles/positron";
}
