// Web implementation of CourtMap: the native MapLibre module does not run on
// Expo web, so Metro resolves this file instead (.web.tsx).
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";
import Map, {
  AttributionControl,
  GeolocateControl,
  Marker,
  type MapRef,
} from "react-map-gl/maplibre";
import { useTheme } from "@/lib/theme";
import { useMapStyle } from "./map-style";
import { CourtPinMarker } from "./pin";
import { type CourtMapProps } from "./types";

// MapLibre 6 resolves its tile worker relative to its own module file, which
// Metro renames on export and never emits alongside it — the default URL falls
// through to the SPA's index.html and the map renders no tiles. The export step
// (scripts/copy-maplibre-worker.mjs) ships the worker under a versioned path;
// point MapLibre at it before the first map is created. Passed to <Map> as a
// promise so maplibre-gl stays out of the entry bundle.
const mapLib = import("maplibre-gl").then((lib) => {
  lib.setWorkerUrl(`/maplibre/${lib.getVersion()}/maplibre-gl-worker.mjs`);
  return lib;
});

// Reports the map's current viewport as a bbox. Shared by the load and
// move-end handlers so both report the region identically.
function emitRegion(
  map: {
    getBounds: () =>
      | { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number }
      | null;
  },
  onRegionChange: CourtMapProps["onRegionChange"],
): void {
  const b = map.getBounds();
  if (!b) return;
  onRegionChange?.({
    minLng: b.getWest(),
    minLat: b.getSouth(),
    maxLng: b.getEast(),
    maxLat: b.getNorth(),
  });
}

export default function CourtMap({
  courts,
  initialCenter,
  initialZoom = 13,
  cameraTarget,
  onRegionChange,
  onPinPress,
  showUserLocation = true,
  mode,
  selectedCourtId,
  hoveredCourtId,
  attributionPosition = "bottom-right",
  style,
}: CourtMapProps) {
  const t = useTheme();
  const mapStyle = useMapStyle(t.scheme);
  const mapRef = useRef<MapRef>(null);

  useEffect(() => {
    if (!cameraTarget) return;
    if (cameraTarget.kind === "bounds") {
      const b = cameraTarget.bbox;
      mapRef.current?.fitBounds(
        [
          [b.minLng, b.minLat],
          [b.maxLng, b.maxLat],
        ],
        { padding: 48, duration: 700 },
      );
    } else {
      mapRef.current?.flyTo({
        center: [cameraTarget.center.lng, cameraTarget.center.lat],
        zoom: cameraTarget.zoom ?? 14,
        duration: 700,
      });
    }
  }, [cameraTarget]);
  return (
    <Map
      ref={mapRef}
      mapLib={mapLib}
      initialViewState={{
        longitude: initialCenter.lng,
        latitude: initialCenter.lat,
        zoom: initialZoom,
      }}
      style={{ flex: 1, ...style }}
      mapStyle={mapStyle as string | StyleSpecification}
      attributionControl={false}
      // The map's first render emits no move event, so onMoveEnd alone left
      // the caller's bbox null until the user happened to pan or zoom —
      // which disabled the court query and showed a brand-new visitor an
      // empty map reading "no courts in view". Reporting the region on load
      // too means the first viewport is queried like any other.
      onLoad={(evt) => emitRegion(evt.target, onRegionChange)}
      onMoveEnd={(evt) => emitRegion(evt.target, onRegionChange)}
    >
      {/* OSM attribution must stay visible; the position prop keeps it out
          of whichever corner the host layout occupies. */}
      <AttributionControl compact position={attributionPosition} />
      {/* Top-left: the one corner the app's own chrome reserves but never
          fills (the toggle row's spacer slot), so the locate button can't
          collide with the filter button (top-right) or the FAB. */}
      {showUserLocation && (
        <GeolocateControl
          trackUserLocation
          position="top-left"
          style={{ marginTop: 19, marginLeft: 16 }}
        />
      )}
      {courts.map((pin) => (
        <Marker
          key={pin.id}
          longitude={pin.lng}
          latitude={pin.lat}
          anchor="center"
        >
          <CourtPinMarker
            pin={pin}
            mode={mode}
            selected={pin.id === selectedCourtId}
            hovered={pin.id === hoveredCourtId}
            onPress={() => onPinPress?.(pin.id)}
          />
        </Marker>
      ))}
    </Map>
  );
}
