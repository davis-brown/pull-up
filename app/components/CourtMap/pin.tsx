import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import type { CourtPin } from "./types";

// Shared pin for both map implementations. A quiet court is a small neutral
// dot; a live court grows and turns green with its player count; unverified
// submissions render hollow.
export function CourtPinMarker({
  pin,
  onPress,
}: {
  pin: CourtPin;
  onPress?: () => void;
}) {
  const t = useTheme();
  const live = pin.activeCount > 0;
  const pending = pin.status === "pending";

  if (!live) {
    return (
      <Pressable onPress={onPress} hitSlop={12}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor: pending ? t.colors.surface : t.colors.accent,
              borderColor: pending ? t.colors.textMuted : t.colors.surface,
            },
          ]}
        />
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View
        style={[
          styles.liveBubble,
          { backgroundColor: t.colors.live, borderColor: t.colors.surface },
        ]}
      >
        <Text style={styles.liveCount}>{pin.activeCount}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  liveBubble: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  liveCount: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
});
