import { Link, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CourtMap from "@/components/CourtMap/CourtMap";
import type { CourtPin } from "@/components/CourtMap/types";
import { useCourtsInBBox, type BBox } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [center, setCenter] = useState<Coords | null>(null);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const { data: courts } = useCourtsInBBox(bbox);

  useEffect(() => {
    void tryGetPosition().then((pos) => setCenter(pos ?? FALLBACK_CENTER));
  }, []);

  const pins = useMemo<CourtPin[]>(
    () =>
      (courts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        activeCount: c.active_count,
        status: c.status,
      })),
    [courts],
  );

  if (!center) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Finding courts near you…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CourtMap
        courts={pins}
        initialCenter={center}
        onRegionChange={setBBox}
        onPinPress={(id) => router.push(`/court/${id}`)}
      />
      <Link href="/court/new" style={[styles.addButton, { bottom: insets.bottom + 24 }]}>
        <Text style={styles.addButtonText}>＋ Add court</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, color: "#777" },
  addButton: {
    position: "absolute",
    right: 16,
    backgroundColor: "#e8590c",
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 18,
    overflow: "hidden",
  },
  addButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
