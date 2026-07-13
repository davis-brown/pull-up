// Web implementation of CourtMap: the native MapLibre module does not run on
// Expo web, so Metro resolves this file instead (.web.tsx).
import "maplibre-gl/dist/maplibre-gl.css";
import Map, { GeolocateControl, Marker } from "react-map-gl/maplibre";
import { useTheme } from "@/lib/theme";
import { CourtPinMarker } from "./pin";
import { mapStyleURL, type CourtMapProps } from "./types";

export default function CourtMap({
  courts,
  initialCenter,
  initialZoom = 13,
  onRegionChange,
  onPinPress,
  showUserLocation = true,
  mode,
  selectedCourtId,
  style,
}: CourtMapProps) {
  const t = useTheme();
  return (
    <Map
      initialViewState={{
        longitude: initialCenter.lng,
        latitude: initialCenter.lat,
        zoom: initialZoom,
      }}
      style={{ flex: 1, ...style }}
      mapStyle={mapStyleURL(t.scheme)}
      onMoveEnd={(evt) => {
        const b = evt.target.getBounds();
        if (!b) return;
        onRegionChange?.({
          minLng: b.getWest(),
          minLat: b.getSouth(),
          maxLng: b.getEast(),
          maxLat: b.getNorth(),
        });
      }}
    >
      {showUserLocation && <GeolocateControl trackUserLocation />}
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
            onPress={() => onPinPress?.(pin.id)}
          />
        </Marker>
      ))}
    </Map>
  );
}
