import type { BBox } from "@/lib/hooks";

export interface CourtPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  activeCount: number;
  status: "pending" | "verified" | "rejected";
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
  style?: object;
}

// OpenFreeMap: free OSM-based vector tiles, no API key, no usage cap.
// Attribution (© OpenStreetMap contributors) comes from the style itself —
// keep the map's attribution control visible.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
