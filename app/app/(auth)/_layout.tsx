import { Redirect, Stack, useGlobalSearchParams, type Href } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { navChrome, useTheme } from "@/lib/theme";

export default function AuthLayout() {
  const { user, loading } = useAuth();
  const t = useTheme();
  // Set by signInHref(): where to send the user once they're signed in.
  const { next } = useGlobalSearchParams<{ next?: string }>();
  if (!loading && user) {
    const target = typeof next === "string" && next.startsWith("/") ? next : "/";
    return <Redirect href={target as Href} />;
  }
  return (
    <Stack screenOptions={navChrome(t)}>
      <Stack.Screen name="login" options={{ title: "Sign in" }} />
      <Stack.Screen name="register" options={{ title: "Create account" }} />
    </Stack>
  );
}
