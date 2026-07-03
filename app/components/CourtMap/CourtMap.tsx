import Mapbox, { Camera, MapView, MarkerView } from "@rnmapbox/maps";
import { StyleSheet } from "react-native";
import { CourtPinMarker } from "./pin";
import { MAPBOX_TOKEN, type CourtMapProps } from "./types";

void Mapbox.setAccessToken(MAPBOX_TOKEN);

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
    <MapView
      style={[styles.map, style]}
      styleURL={Mapbox.StyleURL.Street}
      // Mapbox attribution/logo stay visible per ToS — do not disable.
      onMapIdle={(state) => {
        const { sw, ne } = state.properties.bounds;
        onRegionChange?.({
          minLng: sw[0],
          minLat: sw[1],
          maxLng: ne[0],
          maxLat: ne[1],
        });
      }}
    >
      <Camera
        defaultSettings={{
          centerCoordinate: [initialCenter.lng, initialCenter.lat],
          zoomLevel: initialZoom,
        }}
      />
      {showUserLocation && <Mapbox.UserLocation visible />}
      {courts.map((pin) => (
        <MarkerView key={pin.id} coordinate={[pin.lng, pin.lat]}>
          <CourtPinMarker pin={pin} onPress={() => onPinPress?.(pin.id)} />
        </MarkerView>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
