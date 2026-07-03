// Web implementation of CourtMap: @rnmapbox/maps is a native module and does
// not run on Expo web, so Metro resolves this file instead (.web.tsx).
import "mapbox-gl/dist/mapbox-gl.css";
import Map, { GeolocateControl, Marker } from "react-map-gl/mapbox";
import { CourtPinMarker } from "./pin";
import { MAPBOX_TOKEN, type CourtMapProps } from "./types";

export default function CourtMap({
  courts,
  initialCenter,
  initialZoom = 13,
  onRegionChange,
  onPinPress,
  showUserLocation = true,
  style,
}: CourtMapProps) {
  return (
    <Map
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{
        longitude: initialCenter.lng,
        latitude: initialCenter.lat,
        zoom: initialZoom,
      }}
      style={{ flex: 1, ...style }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
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
          <CourtPinMarker pin={pin} onPress={() => onPinPress?.(pin.id)} />
        </Marker>
      ))}
    </Map>
  );
}
