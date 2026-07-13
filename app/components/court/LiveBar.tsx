import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/theme";

// Sticky bottom bar for the court detail screen: a live-activity readout on
// the left and the primary CHECK IN action on the right. `compact` drops the
// safe-area padding for embedded placements (Task 14 desktop panel).
export function LiveBar({
  liveCount,
  onCheckIn,
  compact,
}: {
  liveCount: number;
  onCheckIn: () => void;
  compact?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const live = liveCount > 0;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: t.colors.surface,
          borderTopColor: t.colors.border,
          paddingBottom: compact ? t.spacing.md : t.spacing.md + insets.bottom,
        },
      ]}
    >
      <View style={styles.status}>
        <View
          style={[
            styles.dot,
            { backgroundColor: live ? t.colors.live : t.colors.quietDot },
          ]}
        />
        <Text style={[t.type.heading, { color: t.colors.textPrimary }]}>
          {live ? `${liveCount} playing now` : "No one playing now"}
        </Text>
      </View>
      <View style={styles.action}>
        <Button title="Check in" onPress={onCheckIn} compact />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  action: {
    flexShrink: 0,
  },
});
