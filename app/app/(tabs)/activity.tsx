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
import { EmptyState } from "@/components/EmptyState";
import { FeedHeader } from "@/components/FeedHeader";
import { QueryError } from "@/components/QueryError";
import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useFeed } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import { useTheme } from "@/lib/theme";
import type { CourtSummary } from "@/lib/types";

const runQualityLabel: Record<string, string> = {
  empty: "Empty",
  casual: "Casual shooting",
  good_run: "Good run",
  packed: "Packed",
};

// Nearby courts ordered by liveness, then distance.
export default function ActivityScreen() {
  const router = useRouter();
  const t = useTheme();
  const [pos, setPos] = useState<Coords | null>(null);
  const { user } = useAuth();
  const feed = useFeed();

  useEffect(() => {
    void tryGetPosition().then((p) => setPos(p ?? FALLBACK_CENTER));
  }, []);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
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
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(c) => c.id}
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.md }}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => {
            void refetch();
            void feed.refetch();
          }}
          tintColor={t.colors.accent}
        />
      }
      ListHeaderComponent={
        user ? (
          <FeedHeader
            friendsHere={feed.data?.friends_here ?? []}
            runs={feed.data?.upcoming_runs ?? []}
            loading={feed.isLoading}
          />
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="map-outline"
          title="No courts within 10 km yet"
          body="Know a court around here? Put it on the map."
          actionTitle="Open the map"
          onAction={() => router.push("/")}
        />
      }
      renderItem={({ item }) => {
        const live = item.active_count > 0;
        const report = item.latest_report;
        return (
          <Pressable onPress={() => router.push(`/court/${item.id}`)}>
            <Card>
              <View style={styles.cardHeader}>
                <Text
                  style={[t.type.heading, styles.name, { color: t.colors.textPrimary }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                {live ? (
                  <View
                    style={[
                      styles.liveBadge,
                      { backgroundColor: t.colors.liveSurface, borderRadius: t.radius.full },
                    ]}
                  >
                    <View style={[styles.liveDot, { backgroundColor: t.colors.live }]} />
                    <Text style={[t.type.caption, { color: t.colors.live, fontWeight: "600" }]}>
                      {item.active_count} here
                    </Text>
                  </View>
                ) : (
                  <Text style={[t.type.caption, { color: t.colors.textMuted }]}>Quiet</Text>
                )}
              </View>
              <Text
                style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.xs }]}
              >
                {(item.distance_m! / 1000).toFixed(1)} km away
                {item.indoor ? "  ·  Indoor" : ""}
                {item.hoop_count ? `  ·  ${item.hoop_count} hoops` : ""}
              </Text>
              {report?.run_quality && (
                <Text
                  style={[
                    t.type.caption,
                    {
                      color: t.colors.textPrimary,
                      marginTop: t.spacing.sm,
                      fontStyle: "italic",
                    },
                  ]}
                >
                  “{runQualityLabel[report.run_quality] ?? report.run_quality}
                  {report.player_count != null ? `, ~${report.player_count} playing` : ""}”
                </Text>
              )}
            </Card>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  name: { flex: 1 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
});
