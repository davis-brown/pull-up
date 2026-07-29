import { Ionicons } from "@expo/vector-icons";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { BADGES } from "@/lib/player";
import { useTheme } from "@/lib/theme";

// The moment for a newly-earned badge. Handles several at once, since one
// check-in can satisfy two rules. Mounted on the profile screen, where the
// badges are and off the map home's overlay layout.
export function BadgeCelebration({
  slugs,
  onDismiss,
}: {
  slugs: string[];
  onDismiss: () => void;
}) {
  const t = useTheme();
  // An id with no catalog entry is a badge shipped ahead of the app; drop it
  // rather than render a blank row. The ack still clears it.
  const earned = slugs
    .map((slug) => BADGES.find((b) => b.id === slug))
    .filter((b): b is (typeof BADGES)[number] => !!b);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={earned.length > 0}
      onRequestClose={onDismiss}
    >
      <View style={[styles.overlay, { backgroundColor: t.colors.overlay }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              borderColor: t.colors.border,
              borderRadius: t.radius.lg,
              padding: t.spacing.xl,
            },
          ]}
        >
          <Text style={[t.type.heading, styles.text, { color: t.colors.textPrimary }]}>
            {earned.length > 1 ? "New badges" : "New badge"}
          </Text>

          <View style={[styles.list, { marginVertical: t.spacing.md }]}>
            {earned.map((b) => (
              <View key={b.id} style={styles.row}>
                <Ionicons name={b.icon as never} size={28} color={t.colors.accent} />
                <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>{b.label}</Text>
              </View>
            ))}
          </View>

          <Button title="Nice" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 360, borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  text: { textAlign: "center" },
  list: { gap: 12, alignSelf: "stretch" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
