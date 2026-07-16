import { useRouter, type Href } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { sessionTimeLabel } from "@/components/CourtSessions";
import { Card, Overline } from "@/components/ui";
import { relativeSince } from "@/lib/relative-time";
import { safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { FeedRun, FriendPresence } from "@/lib/types";

// The signed-in feed shown above the nearby-courts list on the Activity tab:
// mutual-follow friends checked in now, then upcoming runs from followed
// planners / favorited courts. Empty sections are hidden; when both are empty
// a single prompt is shown instead.
export function FeedHeader({
  friendsHere,
  runs,
  loading,
}: {
  friendsHere: FriendPresence[];
  runs: FeedRun[];
  loading?: boolean;
}) {
  const t = useTheme();
  const router = useRouter();

  if (friendsHere.length === 0 && runs.length === 0) {
    // Nothing to show yet while the feed is still loading — avoid flashing the
    // "fill your feed" prompt to a user who actually has feed content.
    if (loading) return null;
    return (
      <Text style={[t.type.caption, { color: t.colors.textMuted, marginBottom: t.spacing.md }]}>
        Follow players and favorite courts to fill your feed.
      </Text>
    );
  }

  return (
    <View>
      {friendsHere.length > 0 ? (
        <View style={{ marginBottom: t.spacing.md }}>
          <Overline style={{ marginBottom: t.spacing.sm }}>Friends here now</Overline>
          {friendsHere.map((f) => (
            <Pressable
              key={`${f.id}-${f.court_id}`}
              style={[styles.friendRow, { gap: t.spacing.md }]}
              onPress={() => router.push(`/court/${safePathSegment(f.court_id)}` as Href)}
            >
              <Avatar avatarUrl={f.avatar_url} displayName={f.display_name} seed={f.id} size={36} />
              <View style={styles.friendText}>
                <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]} numberOfLines={1}>
                  {f.display_name}
                </Text>
                <Text style={[t.type.caption, { color: t.colors.textSecondary }]} numberOfLines={1}>
                  at {f.court_name}  ·  {relativeSince(f.since)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {runs.length > 0 ? (
        <View style={{ marginBottom: t.spacing.md }}>
          <Overline style={{ marginBottom: t.spacing.sm }}>Upcoming runs</Overline>
          {runs.map((run) => (
            <Pressable
              key={run.id}
              onPress={() => router.push(`/court/${safePathSegment(run.court_id)}?run=${safePathSegment(run.id)}` as Href)}
            >
              <Card>
                <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
                  {sessionTimeLabel(run.starts_at)}  ·  {run.court_name}
                </Text>
                <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
                  {run.going_count} going  ·  planned by {run.created_by_name}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  friendRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  friendText: { flex: 1 },
});
