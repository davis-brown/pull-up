import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CourtMap from "@/components/CourtMap/CourtMap";
import type { CourtPin } from "@/components/CourtMap/types";
import { useCourtsInBBox, type BBox } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import { useTheme } from "@/lib/theme";

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
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
      <View style={[styles.loading, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
        <Text style={[t.type.body, { color: t.colors.textSecondary, marginTop: t.spacing.md }]}>
          Finding courts near you…
        </Text>
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
      <Pressable
        onPress={() => router.push("/court/new")}
        style={({ pressed }) => [
          styles.fab,
          {
            bottom: insets.bottom + 24,
            backgroundColor: t.colors.accent,
            borderRadius: t.radius.full,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={20} color={t.colors.onAccent} />
        <Text style={[t.type.bodyMedium, { color: t.colors.onAccent }]}>Add court</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 18,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
});
