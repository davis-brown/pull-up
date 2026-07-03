import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import type { CourtSummary } from "@/lib/types";

const runQualityLabel: Record<string, string> = {
  empty: "Empty",
  casual: "Casual shooting",
  good_run: "Good run 🔥",
  packed: "Packed",
};

// Nearby courts ordered by distance, live ones first.
export default function ActivityScreen() {
  const router = useRouter();
  const [pos, setPos] = useState<Coords | null>(null);

  useEffect(() => {
    void tryGetPosition().then((p) => setPos(p ?? FALLBACK_CENTER));
  }, []);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["courts", "nearby", pos],
    enabled: pos != null,
    refetchInterval: 45_000,
    queryFn: async () => {
      const res = await api<{ courts: CourtSummary[] }>(
        `/courts?lat=${pos!.lat}&lng=${pos!.lng}&radius_m=10000`,
      );
      return [...res.courts].sort((a, b) => b.active_count - a.active_count);
    },
  });

  if (!pos || isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(c) => c.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      ListEmptyComponent={
        <View style={styles.center}>
          <Text style={styles.empty}>
            No courts within 10 km yet. Add the first one from the map tab!
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const live = item.active_count > 0;
        const report = item.latest_report;
        return (
          <Pressable style={styles.card} onPress={() => router.push(`/court/${item.id}`)}>
            <View style={styles.cardHeader}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.count, live ? styles.live : styles.quiet]}>
                {live ? `${item.active_count} here` : "quiet"}
              </Text>
            </View>
            <Text style={styles.meta}>
              {(item.distance_m! / 1000).toFixed(1)} km away
              {item.indoor ? " · indoor" : ""}
              {item.hoop_count ? ` · ${item.hoop_count} hoops` : ""}
            </Text>
            {report?.run_quality && (
              <Text style={styles.report}>
                “{runQualityLabel[report.run_quality] ?? report.run_quality}
                {report.player_count != null ? `, ~${report.player_count} playing` : ""}”
              </Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  empty: { color: "#777", textAlign: "center", marginTop: 48 },
  list: { padding: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#eee",
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 16, fontWeight: "700", flex: 1, marginRight: 8 },
  count: { fontWeight: "700", fontSize: 13 },
  live: { color: "#1a7f1a" },
  quiet: { color: "#999" },
  meta: { color: "#777", marginTop: 4, fontSize: 13 },
  report: { color: "#444", marginTop: 6, fontStyle: "italic", fontSize: 13 },
});
