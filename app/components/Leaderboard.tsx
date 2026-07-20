import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { useTheme } from "@/lib/theme";
import type { Leaderboard as LeaderboardData } from "@/lib/types";

// One component for both boards (phase 22). They differ only in what the
// score counts, which the server names in `metric` — so the client does not
// need to know which endpoint it came from.
const METRIC_SUFFIX: Record<string, string> = {
  check_ins: "runs",
  xp: "XP",
};

function scoreLabel(score: number, metric: string): string {
  const suffix = METRIC_SUFFIX[metric];
  return suffix ? `${score} ${suffix}` : String(score);
}

export function Leaderboard({
  data,
  emptyMessage,
  viewerId,
}: {
  data: LeaderboardData | undefined;
  emptyMessage: string;
  viewerId: string | undefined;
}) {
  const t = useTheme();

  if (!data) return null;
  if (data.entries.length === 0) {
    return (
      <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>{emptyMessage}</Text>
    );
  }

  return (
    <View style={styles.list}>
      {data.entries.map((entry) => {
        const isViewer = entry.user_id === viewerId;
        return (
          <View
            key={entry.user_id}
            style={[
              styles.row,
              isViewer && {
                backgroundColor: t.colors.accentSurface,
                borderRadius: t.radius.md,
              },
            ]}
          >
            <Text
              style={[t.type.caption, styles.rank, { color: t.colors.textSecondary }]}
              // The rank column is fixed-width so avatars line up whether the
              // board runs to one digit or two.
              numberOfLines={1}
            >
              {entry.rank}
            </Text>
            <Avatar
              avatarUrl={entry.avatar_url}
              displayName={entry.display_name}
              seed={entry.user_id}
              size={28}
            />
            <Text
              style={[t.type.body, styles.name, { color: t.colors.textPrimary }]}
              numberOfLines={1}
            >
              {entry.display_name}
            </Text>
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
              {scoreLabel(entry.score, entry.metric)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 8 },
  rank: { width: 22, textAlign: "right" },
  name: { flex: 1 },
});
