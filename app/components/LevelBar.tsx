import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { levelProgressRatio, xpKindLabel, xpToNextLabel } from "@/lib/levels";
import type { MeStats } from "@/lib/types";

// Level, tier, and progress to the next level, from /me/stats. Renders a
// neutral zero-state before stats land rather than flashing a wrong level.
// The header row expands to show the recent XP breakdown, collapsed by
// default.
export function LevelBar({ stats }: { stats: MeStats | undefined }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const level = stats?.level ?? 1;
  const tier = stats?.tier ?? "Rookie";
  const ratio = levelProgressRatio(stats);
  const breakdown = stats?.xp_breakdown ?? [];
  const canExpand = breakdown.length > 0;

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={canExpand ? () => setExpanded((v) => !v) : undefined}
        disabled={!canExpand}
        accessibilityRole={canExpand ? "button" : undefined}
        accessibilityState={canExpand ? { expanded } : undefined}
        accessibilityLabel={
          canExpand ? `Level ${level}, ${tier}. Show how you earned it.` : undefined
        }
        style={styles.headerRow}
      >
        <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
          Level {level} · {tier}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
          {xpToNextLabel(stats)}
        </Text>
      </Pressable>

      <View
        style={[styles.track, { backgroundColor: t.colors.surfaceMuted, borderRadius: t.radius.full }]}
      >
        {/* Spec 3e: the XP fill runs violet → lime left-to-right. */}
        <LinearGradient
          colors={[t.colors.accent, t.colors.xp]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            styles.fill,
            {
              width: `${Math.round(ratio * 100)}%`,
              borderRadius: t.radius.full,
            },
          ]}
        />
      </View>

      {/* Season standing sits under the lifetime bar rather than replacing
          it: the level is who you are, the season is how you're doing now. */}
      {stats?.season ? (
        <View style={styles.seasonRow}>
          <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
            {stats.season.label}
          </Text>
          <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
            {stats.season.xp} XP · {stats.season.tier}
          </Text>
        </View>
      ) : null}

      {expanded && canExpand ? (
        <View style={styles.breakdown}>
          <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>LAST 30 DAYS</Text>
          {breakdown.map((entry) => (
            <View key={entry.kind} style={styles.breakdownRow}>
              <Text
                style={[t.type.caption, styles.breakdownLabel, { color: t.colors.textPrimary }]}
                numberOfLines={1}
              >
                {xpKindLabel(entry.kind)}
                {entry.events > 1 ? ` ×${entry.events}` : ""}
              </Text>
              <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
                +{entry.points}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 14, gap: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  track: { height: 8, overflow: "hidden" },
  fill: { height: 8 },
  seasonRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingTop: 2 },
  breakdown: { gap: 4, paddingTop: 4 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 12 },
  breakdownLabel: { flexShrink: 1 },
});
