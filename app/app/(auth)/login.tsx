import { Link, useLocalSearchParams, type Href } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { OAuthButtons } from "@/components/OAuthButtons";
import { Button, ErrorText, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const t = useTheme();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={[t.type.display, styles.center, { color: t.colors.accent }]}>
        pull-up
      </Text>
      <Text
        style={[
          t.type.body,
          styles.center,
          { color: t.colors.textSecondary, marginBottom: t.spacing.xl },
        ]}
      >
        Find a run near you
      </Text>
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
        placeholder="Your password"
      />
      <ErrorText message={error} />
      <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
      <OAuthButtons />
      <View style={[styles.footer, { marginTop: t.spacing.lg }]}>
        <Text style={[t.type.body, { color: t.colors.textSecondary }]}>New here? </Text>
        <Link
          href={(next ? `/register?next=${encodeURIComponent(next)}` : "/register") as Href}
          style={[t.type.bodyMedium, { color: t.colors.accent }]}
        >
          Create an account
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
