import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { navChrome, useTheme } from "@/lib/theme";

export default function AuthLayout() {
  const { user, loading } = useAuth();
  const t = useTheme();
  if (!loading && user) {
    return <Redirect href="/" />;
  }
  return (
    <Stack screenOptions={navChrome(t)}>
      <Stack.Screen name="login" options={{ title: "Sign in" }} />
      <Stack.Screen name="register" options={{ title: "Create account" }} />
    </Stack>
  );
}
