import * as Location from "expo-location";

export interface Coords {
  lat: number;
  lng: number;
}

// Default map center before we know where the user is (NYC).
export const FALLBACK_CENTER: Coords = { lat: 40.7549, lng: -73.984 };

export async function getCurrentPosition(): Promise<Coords> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission is required");
  }
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

// Best-effort variant for centering the map — never throws.
export async function tryGetPosition(): Promise<Coords | null> {
  try {
    return await getCurrentPosition();
  } catch {
    return null;
  }
}
