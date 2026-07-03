import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AuthGate } from "@/components/AuthGate";
import CourtMap from "@/components/CourtMap/CourtMap";
import { Button, Chip, ErrorText, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useCreateCourt, type BBox } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import type { NearbyDuplicate, Surface } from "@/lib/types";

const surfaces: Surface[] = ["asphalt", "concrete", "hardwood", "rubber", "other"];

// Pin-drop flow: the map pans under a fixed center crosshair; the court is
// created wherever the crosshair points when the user submits.
export default function NewCourtScreen() {
  const router = useRouter();
  const createCourt = useCreateCourt();
  // Open the map at the user's location — they're usually standing at the
  // court they're adding.
  const [start, setStart] = useState<Coords | null>(null);
  const center = useRef<Coords>(FALLBACK_CENTER);

  useEffect(() => {
    void tryGetPosition().then((pos) => {
      const at = pos ?? FALLBACK_CENTER;
      center.current = at;
      setStart(at);
    });
  }, []);
  const [name, setName] = useState("");
  const [hoops, setHoops] = useState("");
  const [indoor, setIndoor] = useState(false);
  const [surface, setSurface] = useState<Surface | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<NearbyDuplicate[]>([]);

  const onRegionChange = (bbox: BBox) => {
    center.current = {
      lat: (bbox.minLat + bbox.maxLat) / 2,
      lng: (bbox.minLng + bbox.maxLng) / 2,
    };
  };

  const submit = (ignoreDuplicates: boolean) => {
    setError(null);
    setDuplicates([]);
    const hoopCount = hoops.trim() === "" ? undefined : Number(hoops);
    if (hoopCount !== undefined && (!Number.isInteger(hoopCount) || hoopCount < 1)) {
      setError("Hoop count must be a whole number");
      return;
    }
    createCourt.mutate(
      {
        name: name.trim(),
        lat: center.current.lat,
        lng: center.current.lng,
        hoop_count: hoopCount,
        indoor,
        surface: surface ?? undefined,
        ignore_duplicates: ignoreDuplicates,
      },
      {
        onSuccess: (court) => router.replace(`/court/${court.id}`),
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            setDuplicates((e.body.possible_duplicates as NearbyDuplicate[]) ?? []);
          } else {
            setError(e.message);
          }
        },
      },
    );
  };

  return (
    <AuthGate>
      <View style={styles.container}>
        <View style={styles.mapWrap}>
          {start ? (
            <>
              <CourtMap
                courts={[]}
                initialCenter={start}
                initialZoom={16}
                onRegionChange={onRegionChange}
                showUserLocation
              />
              {/* Fixed crosshair: drag the map underneath it. */}
              <View pointerEvents="none" style={styles.crosshair}>
                <Text style={styles.crosshairText}>📍</Text>
              </View>
            </>
          ) : (
            <View style={styles.mapLoading}>
              <ActivityIndicator size="large" />
              <Text style={styles.mapLoadingText}>Finding your location…</Text>
            </View>
          )}
        </View>

        <ScrollView style={styles.form} contentContainerStyle={styles.formContent}>
          <Text style={styles.hint}>Line the pin up with the court, then fill this in.</Text>
          <Field
            label="Court name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            placeholder="e.g. Riverside Park Courts"
          />
          <Field
            label="Hoops (optional)"
            value={hoops}
            onChangeText={setHoops}
            keyboardType="number-pad"
            placeholder="e.g. 4"
          />
          <View style={styles.chips}>
            <Chip label={indoor ? "Indoor ✓" : "Indoor?"} selected={indoor} onPress={() => setIndoor(!indoor)} />
            {surfaces.map((s) => (
              <Chip
                key={s}
                label={s}
                selected={surface === s}
                onPress={() => setSurface(surface === s ? null : s)}
              />
            ))}
          </View>

          {duplicates.length > 0 && (
            <View style={styles.dupeBox}>
              <Text style={styles.dupeTitle}>Is it one of these?</Text>
              {duplicates.map((d) => (
                <Pressable key={d.id} onPress={() => router.replace(`/court/${d.id}`)}>
                  <Text style={styles.dupeItem}>
                    → {d.name} ({Math.round(d.distance_m)} m away)
                  </Text>
                </Pressable>
              ))}
              <Button
                title="No — create a new court here"
                variant="secondary"
                busy={createCourt.isPending}
                onPress={() => submit(true)}
              />
            </View>
          )}

          <ErrorText message={error} />
          {duplicates.length === 0 && (
            <Button
              title="Add court"
              busy={createCourt.isPending}
              disabled={!name.trim()}
              onPress={() => submit(false)}
            />
          )}
        </ScrollView>
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapWrap: { height: 280 },
  mapLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  mapLoadingText: { marginTop: 8, color: "#777" },
  crosshair: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  crosshairText: { fontSize: 34, marginBottom: 30 },
  form: { flex: 1 },
  formContent: { padding: 16 },
  hint: { color: "#777", marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginVertical: 8 },
  dupeBox: {
    backgroundColor: "#fffaeb",
    borderColor: "#f0c000",
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginVertical: 8,
  },
  dupeTitle: { fontWeight: "800", marginBottom: 6, color: "#9a7b00" },
  dupeItem: { color: "#e8590c", fontWeight: "600", paddingVertical: 6 },
});
