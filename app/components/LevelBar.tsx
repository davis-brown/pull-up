import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { levelProgressRatio, xpToNextLabel } from "@/lib/levels";
import type { MeStats } from "@/lib/types";

// Level, tier, and progress to the next level (phase 20). Reads from
// /me/stats; renders a neutral zero-state before stats land rather than
// flashing a wrong level.
export function LevelBar({ stats }: { stats: MeStats | undefined }) {
  const t = useTheme();
  const level = stats?.level ?? 1;
  const tier = stats?.tier ?? "Rookie";
  const ratio = levelProgressRatio(stats);

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
          Level {level} · {tier}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
          {xpToNextLabel(stats)}
        </Text>
      </View>
      <View
        style={[styles.track, { backgroundColor: t.colors.surfaceMuted, borderRadius: t.radius.full }]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${Math.round(ratio * 100)}%`,
              backgroundColor: t.colors.accent,
              borderRadius: t.radius.full,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 14, gap: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  track: { height: 8, overflow: "hidden" },
  fill: { height: 8 },
});
