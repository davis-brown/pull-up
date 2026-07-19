import { Ionicons } from "@expo/vector-icons";
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
import { FilterSheet } from "@/components/FilterSheet";
import { QueryError } from "@/components/QueryError";
import { Card, FullScreenLoader } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { filtersToQuery, type CourtFilters } from "@/lib/court-filters";
import { useFeed } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import { safePathSegment } from "@/lib/routes";
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
  const [filters, setFilters] = useState<CourtFilters>({});
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const { user } = useAuth();
  const feed = useFeed();
  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== undefined,
  ).length;

  useEffect(() => {
    void tryGetPosition().then((p) => setPos(p ?? FALLBACK_CENTER));
  }, []);

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["courts", "nearby", pos, filters],
    enabled: pos != null,
    refetchInterval: (q) => (q.state.data?.seeding ? 5_000 : 45_000),
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await api<{ courts: CourtSummary[]; seeding?: boolean }>(
        "/courts/search",
        {
          method: "POST",
          body: JSON.stringify({
            query: `lat=${pos!.lat}&lng=${pos!.lng}&radius_m=10000${filtersToQuery(filters)}`,
          }),
        },
      );
      const sorted = [...res.courts].sort(
        (a, b) => b.active_count - a.active_count,
      );
      return { courts: sorted, seeding: !!res.seeding };
    },
  });

  if (!pos || isLoading) {
    return <FullScreenLoader />;
  }

  if (error && !data) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={data?.courts ?? []}
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
          <>
            <Pressable
              onPress={() => setFilterSheetOpen(true)}
              style={[
                styles.filterButton,
                {
                  borderColor: t.colors.chipBorder,
                  borderRadius: t.radius.full,
                  backgroundColor: t.colors.surface,
                },
              ]}
            >
              <Ionicons
                name="options"
                size={16}
                color={t.colors.textSecondary}
              />
              <Text
                style={[t.type.bodyMedium, { color: t.colors.textSecondary }]}
              >
                Filters
              </Text>
              {activeFilterCount > 0 && (
                <View
                  style={[
                    styles.filterButtonBadge,
                    {
                      backgroundColor: t.colors.accent,
                      borderRadius: t.radius.full,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.type.caption,
                      styles.filterButtonBadgeText,
                      { color: t.colors.onAccent },
                    ]}
                  >
                    {activeFilterCount}
                  </Text>
                </View>
              )}
            </Pressable>
            {user ? (
              feed.error && !feed.data ? (
                <QueryError error={feed.error} onRetry={() => void feed.refetch()} />
              ) : (
                <FeedHeader
                  friendsHere={feed.data?.friends_here ?? []}
                  runs={feed.data?.upcoming_runs ?? []}
                  loading={feed.isLoading}
                />
              )
            ) : null}
          </>
        }
        ListEmptyComponent={
          data?.seeding ? (
            <View style={styles.seedingEmpty}>
              <ActivityIndicator size="small" color={t.colors.accent} />
              <Text
                style={[
                  t.type.body,
                  { color: t.colors.textSecondary, marginTop: t.spacing.sm },
                ]}
              >
                Finding courts in this area…
              </Text>
            </View>
          ) : (
            <EmptyState
              icon="map-outline"
              title="No courts within 10 km yet"
              body="Know a court around here? Put it on the map."
              actionTitle="Open the map"
              onAction={() => router.push("/")}
            />
          )
        }
        renderItem={({ item }) => {
          const live = item.active_count > 0;
          const report = item.latest_report;
          return (
            <Pressable onPress={() => router.push(`/court/${safePathSegment(item.id)}`)}>
              <Card>
                <View style={styles.cardHeader}>
                  <Text
                    style={[
                      t.type.heading,
                      styles.name,
                      { color: t.colors.textPrimary },
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {live ? (
                    <View
                      style={[
                        styles.liveBadge,
                        {
                          backgroundColor: t.colors.liveSurface,
                          borderRadius: t.radius.full,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.liveDot,
                          { backgroundColor: t.colors.live },
                        ]}
                      />
                      <Text
                        style={[
                          t.type.caption,
                          { fontFamily: t.fonts.bodySemi, color: t.colors.live },
                        ]}
                      >
                        {item.active_count} here
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={[t.type.caption, { color: t.colors.textMuted }]}
                    >
                      Quiet
                    </Text>
                  )}
                </View>
                <Text
                  style={[
                    t.type.caption,
                    { color: t.colors.textSecondary, marginTop: t.spacing.xs },
                  ]}
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
                    {report.player_count != null
                      ? `, ~${report.player_count} playing`
                      : ""}
                    ”
                  </Text>
                )}
              </Card>
            </Pressable>
          );
        }}
      />
      <FilterSheet
        visible={filterSheetOpen}
        filters={filters}
        courts={data?.courts ?? []}
        onApply={setFilters}
        onClose={() => setFilterSheetOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  seedingEmpty: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    paddingTop: 48,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  filterButtonBadge: {
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterButtonBadgeText: {
    fontSize: 11,
    lineHeight: 13,
  },
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
