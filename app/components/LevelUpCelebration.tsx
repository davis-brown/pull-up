import { Ionicons } from "@expo/vector-icons";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/theme";

// The in-app half of levelling up (phase 21). Until now a crossing only
// produced a push, so a player levelling with the app open saw nothing.
//
// Mounted on the profile screen rather than globally: the level-up push
// deep-links to view_profile, so this is where a player arrives expecting
// it, and keeping it off the map home avoids competing for a slot in the
// map's overlay layout.
// tier comes from /me/stats rather than being recomputed here: the tier
// table lives in internal/api/xp.go, and MarkLevelUpPending stores the
// highest unseen level, which is always the player's current level — so
// the stats tier is the right label for the level being celebrated.
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
