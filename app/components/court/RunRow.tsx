import { Pressable, StyleSheet, Text, View } from "react-native";
import { sessionTimeLabel } from "@/components/CourtSessions";
import { useTheme } from "@/lib/theme";
import type { SessionSummary } from "@/lib/types";

// Bordered summary of a single planned run with an outline JOIN chip. A
// presentational building block: it renders session data and delegates the
// join intent to its parent. Reused by the desktop panel (Task 14).
export function RunRow({
  session,
  onJoin,
}: {
  session: SessionSummary;
  onJoin: () => void;
}) {
  const t = useTheme();

  const count =
    session.capacity != null
      ? `${session.going_count} of ${session.capacity} in`
      : `${session.going_count} in`;

  return (
    <View
      style={[
        styles.row,
        { borderColor: t.colors.border, borderRadius: 14 },
      ]}
    >
      <View style={styles.body}>
        <Text style={[t.type.heading, { color: t.colors.textPrimary }]}>
          {sessionTimeLabel(session.starts_at)} run
        </Text>
        <Text style={[t.type.caption, styles.sub, { color: t.colors.textSecondary }]}>
          {count} · hosted by {session.host_name}
        </Text>
      </View>
      <Pressable
        onPress={onJoin}
        style={[
          styles.join,
          { borderColor: t.colors.accent, borderRadius: t.radius.full },
        ]}
      >
        <Text style={[t.type.label, { color: t.colors.accent }]}>Join</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  body: { flex: 1 },
  sub: { marginTop: 2 },
  join: {
    borderWidth: 1.5,
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
});
