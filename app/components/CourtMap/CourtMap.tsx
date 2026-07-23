import { Camera, Map, Marker, UserLocation } from "@maplibre/maplibre-react-native";
import { StyleSheet } from "react-native";
import { useTheme } from "@/lib/theme";
import { useMapStyle } from "./map-style";
import { CourtPinMarker } from "./pin";
import { type CourtMapProps } from "./types";

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
  const mapStyle = useMapStyle(t.scheme);
  return (
    <Map
      style={[styles.map, style]}
      mapStyle={mapStyle as string}
      onRegionDidChange={(event) => {
        const [west, south, east, north] = event.nativeEvent.bounds;
        onRegionChange?.({
          minLng: west,
          minLat: south,
          maxLng: east,
          maxLat: north,
        });
      }}
    >
      <Camera
        initialViewState={{
          center: [initialCenter.lng, initialCenter.lat],
          zoom: initialZoom,
        }}
      />
      {showUserLocation && <UserLocation />}
      {courts.map((pin) => (
        <Marker key={pin.id} lngLat={[pin.lng, pin.lat]}>
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

const styles = StyleSheet.create({
  map: { flex: 1 },
});
