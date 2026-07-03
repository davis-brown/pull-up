import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function AuthLayout() {
  const { user, loading } = useAuth();
  if (!loading && user) {
    return <Redirect href="/" />;
  }
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: "Sign in" }} />
      <Stack.Screen name="register" options={{ title: "Create account" }} />
    </Stack>
  );
}
