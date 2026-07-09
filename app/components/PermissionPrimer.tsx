import { Ionicons } from "@expo/vector-icons";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/theme";

// Pre-permission explainer sheet: shown BEFORE the OS permission dialog so
// the request lands with context (and store reviewers see the disclosure).
export function PermissionPrimer({
  visible,
  icon,
  title,
  body,
  allowLabel,
  onAllow,
  onDismiss,
}: {
  visible: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  allowLabel: string;
  onAllow: () => void;
  onDismiss: () => void;
}) {
  const t = useTheme();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onDismiss}>
      <View style={styles.overlay}>
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
          <Ionicons name={icon} size={40} color={t.colors.accent} style={styles.icon} />
          <Text
            style={[t.type.heading, styles.text, { color: t.colors.textPrimary, marginTop: t.spacing.md }]}
          >
            {title}
          </Text>
          <Text
            style={[t.type.body, styles.text, { color: t.colors.textSecondary, marginVertical: t.spacing.md }]}
          >
            {body}
          </Text>
          <Button title={allowLabel} onPress={onAllow} />
          <Button title="Not now" variant="ghost" onPress={onDismiss} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sheet: { width: "100%", maxWidth: 420, borderWidth: StyleSheet.hairlineWidth },
  icon: { alignSelf: "center" },
  text: { textAlign: "center" },
});
