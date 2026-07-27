import {
  Camera,
  type CameraRef,
  Map,
  Marker,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "@/lib/theme";
import { useMapStyle } from "./map-style";
import { CourtPinMarker } from "./pin";
import { type CourtMapProps } from "./types";

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
  style,
}: CourtMapProps) {
  const t = useTheme();
  const mapStyle = useMapStyle(t.scheme);
  const cameraRef = useRef<CameraRef>(null);

  useEffect(() => {
    if (!cameraTarget) return;
    if (cameraTarget.kind === "bounds") {
      const b = cameraTarget.bbox;
      cameraRef.current?.fitBounds([b.minLng, b.minLat, b.maxLng, b.maxLat], {
        padding: { top: 72, right: 32, bottom: 72, left: 32 },
        duration: 700,
      });
    } else {
      cameraRef.current?.flyTo({
        center: [cameraTarget.center.lng, cameraTarget.center.lat],
        zoom: cameraTarget.zoom ?? 14,
        duration: 700,
      });
    }
  }, [cameraTarget]);
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
        ref={cameraRef}
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
