import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from "react-native";
import { Button, ErrorText, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

function useVerificationToken(): string | undefined {
  const [token, setToken] = useState<string | undefined>();
  useEffect(() => {
    // Read the credential from the URL fragment so it is never sent in
    // Referer headers or captured by edge invocation logs.
    const hash = globalThis.location?.hash ?? "";
    const value = hash.replace(/^#/, "");
    const params = new URLSearchParams(value);
    const t = params.get("token") ?? undefined;
    if (t && globalThis.location) {
      // Clear the fragment from history so it cannot be leaked through
      // browser history or accidental sharing of the same URL.
      globalThis.history.replaceState(null, "", globalThis.location.pathname + globalThis.location.search);
    }
    setToken(t);
  }, []);
  return token;
}

export default function VerifyEmailScreen() {
  const { email, sent } = useLocalSearchParams<{
    email?: string;
    sent?: string;
  }>();
  const token = useVerificationToken();
  const { verifyEmail, requestEmailVerification } = useAuth();
  const t = useTheme();
  const [emailDraft, setEmailDraft] = useState(email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(
    sent === "0"
      ? "Your account was created, but the email could not be sent. Try again below."
      : "Open the verification link in your email to finish creating your account.",
  );

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify this email.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    const normalized = emailDraft.trim().toLowerCase();
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      await requestEmailVerification(normalized);
      setMessage("If that account is awaiting verification, a new link is on its way.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not request a new link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: t.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={[t.type.title, styles.center, { color: t.colors.textPrimary }]}>Verify your email</Text>
      <Text
        style={[
          t.type.body,
          styles.center,
          { color: t.colors.textSecondary, marginTop: t.spacing.sm, marginBottom: t.spacing.lg },
        ]}
      >
        {token ? "Confirm the address associated with this verification link." : message}
      </Text>
      {token ? (
        <Button title="Verify email" busy={busy} onPress={() => void confirm()} />
      ) : (
        <>
          <Field
            label="Email"
            value={emailDraft}
            onChangeText={setEmailDraft}
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
          />
          <Button
            title="Send a new link"
            variant="secondary"
            busy={busy}
            disabled={!emailDraft.trim()}
            onPress={() => void resend()}
          />
        </>
      )}
      <ErrorText message={error} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  center: { textAlign: "center" },
});
