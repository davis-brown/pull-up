import { Ionicons } from "@expo/vector-icons";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/theme";

// The in-app half of levelling up. Mounted on the profile screen, where the
// level-up push deep-links to.
//
// tier comes from /me/stats rather than being recomputed: the tier table
// lives in internal/api/xp.go, and MarkLevelUpPending stores the highest
// unseen level, which is always the player's current one.
export function LevelUpCelebration({
  level,
  tier,
  onDismiss,
}: {
  level: number | null;
  tier: string | undefined;
  onDismiss: () => void;
}) {
  const t = useTheme();
  const visible = level !== null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDismiss}>
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
          <Ionicons name="trophy" size={40} color={t.colors.accent} style={styles.icon} />
          <Text
            style={[t.type.heading, styles.text, { color: t.colors.textPrimary, marginTop: t.spacing.md }]}
          >
            Level {level ?? ""}
          </Text>
          <Text
            style={[t.type.body, styles.text, { color: t.colors.textSecondary, marginVertical: t.spacing.md }]}
          >
            {tier ? `You're a ${tier} now. Your run count is showing.` : "Your run count is showing."}
          </Text>
          <Button title="Nice" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheet: { width: "100%", maxWidth: 360, borderWidth: StyleSheet.hairlineWidth, alignItems: "center" },
  icon: { alignSelf: "center" },
  text: { textAlign: "center" },
});
