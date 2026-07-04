import { Redirect } from "expo-router";
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

// Wraps route groups that require a signed-in user.
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const t = useTheme();
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
      </View>
    );
  }
  if (!user) {
    return <Redirect href="/login" />;
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
