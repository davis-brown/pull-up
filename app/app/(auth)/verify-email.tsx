import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from "react-native";
import { Button, ErrorText, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { getErrorMessage } from "@/lib/errors";
import { useTheme } from "@/lib/theme";

// The emailed code only works together with the verification id this app got
// from register or sign-in, so a code typed anywhere else proves nothing.
export default function VerifyEmailScreen() {
  const { email, id, next } = useLocalSearchParams<{
    email?: string;
    id?: string;
    next?: string;
  }>();
  const { verifyEmail, requestEmailVerification } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(
    `We emailed a 6-digit code to ${email || "your address"}. Enter it to finish creating your account.`,
  );

  const confirm = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmail(id, code.trim());
    } catch (e) {
      setError(getErrorMessage(e, "Could not verify this code."));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      await requestEmailVerification(id);
      setCode("");
      setMessage("A new code is on its way. Earlier codes no longer work.");
    } catch (e) {
      setError(getErrorMessage(e, "Could not send a new code."));
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
        {id ? message : "Sign in with your email and password to get a new code."}
      </Text>
      {id ? (
        <>
          <Field
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
          />
          <Button
            title="Verify email"
            busy={busy}
            disabled={code.trim().length !== 6}
            onPress={() => void confirm()}
          />
          <Button
            title="Send a new code"
            variant="secondary"
            busy={busy}
            onPress={() => void resend()}
          />
        </>
      ) : (
        <Button
          title="Sign in"
          onPress={() => router.replace({ pathname: "/login", params: next ? { next } : {} } as Href)}
        />
      )}
      <ErrorText message={error} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: "center" },
  center: { textAlign: "center" },
});
