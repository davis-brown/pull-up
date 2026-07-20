import { useRouter, type Href } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { sessionTimeLabel } from "@/components/CourtSessions";
import { Card, Overline } from "@/components/ui";
import { safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { NearbyRun } from "@/lib/types";

// "Runs near you" rail on the Activity tab (phase 17): upcoming runs at any
// nearby court, for everyone — a player with zero follows still finds a
// game. Mirrors the feed's "Upcoming runs" row look; excludeIds drops runs
// the signed-in feed is already showing so the two rails never duplicate.
// Renders nothing when there's nothing nearby.
export function NearbyRuns({
  runs,
  excludeIds,
}: {
  runs: NearbyRun[];
  excludeIds?: Set<string>;
}) {
  const t = useTheme();
  const router = useRouter();

  const visible = excludeIds ? runs.filter((r) => !excludeIds.has(r.id)) : runs;
  if (visible.length === 0) return null;

  return (
    <View style={{ marginBottom: t.spacing.md }}>
      <Overline style={{ marginBottom: t.spacing.sm }}>Runs near you</Overline>
      {visible.map((run) => (
        <Pressable
          key={run.id}
          onPress={() =>
            router.push(
              `/court/${safePathSegment(run.court_id)}?run=${safePathSegment(run.id)}` as Href,
            )
          }
        >
          <Card>
            <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
              {sessionTimeLabel(run.starts_at)}  ·  {run.court_name}
            </Text>
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
              {run.going_count} going  ·  planned by {run.created_by_name}  ·{" "}
              {(run.distance_m / 1000).toFixed(1)} km
            </Text>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}
