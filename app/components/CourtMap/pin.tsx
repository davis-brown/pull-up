import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CourtPin } from "./types";

// Shared pin rendering for both map implementations: grey = quiet court,
// green + count = players checked in, dashed = unverified submission.
export function CourtPinMarker({
  pin,
  onPress,
}: {
  pin: CourtPin;
  onPress?: () => void;
}) {
  const live = pin.activeCount > 0;
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View
        style={[
          styles.pin,
          live ? styles.live : styles.quiet,
          pin.status === "pending" && styles.pending,
        ]}
      >
        <Text style={styles.emoji}>🏀</Text>
        {live && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pin.activeCount}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  quiet: {
    backgroundColor: "#f0f0f0",
    borderColor: "#9a9a9a",
  },
  live: {
    backgroundColor: "#d3f8d3",
    borderColor: "#1a7f1a",
  },
  pending: {
    borderStyle: "dashed",
  },
  emoji: {
    fontSize: 18,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#1a7f1a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});
