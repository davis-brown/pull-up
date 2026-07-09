import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter, type Href } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { signInHref } from "@/lib/routes";
import { useTheme } from "@/lib/theme";

// Full-screen prompt shown to signed-out users on account-based screens.
export function SignInScreenCta({ message }: { message: string }) {
  const t = useTheme();
  const detour = useSignInDetour();
  return (
    <View
      style={[styles.center, { backgroundColor: t.colors.background, padding: t.spacing.xl }]}
    >
      <Ionicons name="basketball-outline" size={44} color={t.colors.textMuted} />
      <Text
        style={[
          t.type.body,
          styles.message,
          { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.lg },
        ]}
      >
        {message}
      </Text>
      <View style={styles.buttonWrap}>
        <Button title="Sign in" onPress={detour} />
      </View>
    </View>
  );
}

// Inline stand-in for an action control that needs an account
// ("Sign in to check in", "Sign in to chat", …).
export function SignInAction({ label }: { label: string }) {
  const detour = useSignInDetour();
  return <Button title={label} variant="secondary" onPress={detour} />;
}

// Press handler for icon controls (favorite heart, camera): detours the tap
// to the login screen and brings the user back here afterwards.
export function useSignInDetour(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.push(signInHref(pathname) as Href);
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  message: { textAlign: "center" },
  buttonWrap: { alignSelf: "stretch", maxWidth: 320, width: "100%" },
});
