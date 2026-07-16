import { Link, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { Button, ErrorText, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

export default function RegisterScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const result = await signUp(normalizedEmail, password, displayName.trim());
      router.replace({
        pathname: "/verify-email",
        params: {
          email: normalizedEmail,
          ...(next ? { next } : {}),
          sent: "1",
        },
      } as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text
        style={[
          t.type.title,
          styles.center,
          { color: t.colors.textPrimary, marginBottom: t.spacing.lg },
        ]}
      >
        Join the run
      </Text>
      <Field
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        placeholder="How other players see you"
      />
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        placeholder="you@example.com"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="At least 8 characters"
      />
      <ErrorText message={error} />
      <Button
        title="Create account"
        onPress={submit}
        busy={busy}
        disabled={!email || password.length < 8 || !displayName.trim()}
      />
      <View style={[styles.footer, { marginTop: t.spacing.lg }]}>
        <Text style={[t.type.body, { color: t.colors.textSecondary }]}>
          Already have an account?{" "}
        </Text>
        <Link
          href={(next ? `/login?next=${encodeURIComponent(next)}` : "/login") as Href}
          style={[t.type.bodyMedium, { color: t.colors.accent }]}
        >
          Sign in
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  center: { textAlign: "center" },
  footer: { flexDirection: "row", justifyContent: "center" },
});
