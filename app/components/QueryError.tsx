import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useTheme } from "@/lib/theme";

// Friendly failed-query state. RN's fetch rejects with a TypeError when the
// network is unreachable — surface that as "offline" rather than an error.
export function QueryError({
  error,
  onRetry,
  title,
  message,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  message?: string;
}) {
  const t = useTheme();
  const offline = error instanceof TypeError;
  return (
    <View style={[styles.center, { padding: t.spacing.xl }]}>
      <Ionicons
        name={offline ? "cloud-offline-outline" : "alert-circle-outline"}
        size={40}
        color={t.colors.textMuted}
      />
      <Text
        style={[t.type.heading, styles.text, { color: t.colors.textPrimary, marginTop: t.spacing.md }]}
      >
        {title ?? (offline ? "You're offline" : "Something went wrong")}
      </Text>
      <Text
        style={[t.type.body, styles.text, { color: t.colors.textSecondary, marginTop: t.spacing.xs }]}
      >
        {message ?? (offline
          ? "Check your connection and try again."
          : "That didn't load. Give it another try.")}
      </Text>
      {onRetry ? (
        <View style={[styles.buttonWrap, { marginTop: t.spacing.lg }]}>
          <Button title="Try again" variant="secondary" onPress={onRetry} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { textAlign: "center" },
  buttonWrap: { alignSelf: "stretch", maxWidth: 320 },
});
