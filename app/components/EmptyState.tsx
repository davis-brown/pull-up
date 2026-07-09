import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/theme";

// Centered friendly empty state: icon, headline, optional body and action.
export function EmptyState({
  icon = "basketball-outline",
  title,
  body,
  actionTitle,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.center, { padding: t.spacing.xl }]}>
      <Ionicons name={icon} size={40} color={t.colors.textMuted} />
      <Text
        style={[t.type.heading, styles.text, { color: t.colors.textPrimary, marginTop: t.spacing.md }]}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={[t.type.body, styles.text, { color: t.colors.textSecondary, marginTop: t.spacing.xs }]}
        >
          {body}
        </Text>
      ) : null}
      {actionTitle && onAction ? (
        <View style={[styles.buttonWrap, { marginTop: t.spacing.lg }]}>
          <Button title={actionTitle} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  text: { textAlign: "center" },
  buttonWrap: { alignSelf: "stretch", maxWidth: 320 },
});
