// Social sign-in, shown only where configured:
// - Apple: iOS only (expo-apple-authentication); no client-side config needed.
//   The server verifies the identity token against APPLE_AUDIENCES.
// - Google: requires EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (and optionally
//   _IOS_/_ANDROID_ variants); hidden until set. The server verifies against
//   GOOGLE_CLIENT_IDS.
import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Button, ErrorText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme";

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "";

function GoogleButton({ onError }: { onError: (msg: string) => void }) {
  const { oauthSignIn } = useAuth();
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
  });

  useEffect(() => {
    if (response?.type === "success" && response.params.id_token) {
      oauthSignIn("google", response.params.id_token).catch((e) =>
        onError(e instanceof Error ? e.message : "Google sign-in failed"),
      );
    } else if (response?.type === "error") {
      onError("Google sign-in failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  return (
    <Button
      title="Continue with Google"
      variant="secondary"
      disabled={!request}
      onPress={() => void promptAsync()}
    />
  );
}

function AppleButton({ onError }: { onError: (msg: string) => void }) {
  const { oauthSignIn } = useAuth();
  const t = useTheme();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    void AppleAuthentication.isAvailableAsync().then(setAvailable);
  }, []);

  if (!available) return null;

  const signIn = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error("No identity token from Apple");
      // Apple only provides the name on the very first authorization.
      const name = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(" ");
      await oauthSignIn("apple", credential.identityToken, name || undefined);
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") return;
      onError(e instanceof Error ? e.message : "Apple sign-in failed");
    }
  };

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={
        t.scheme === "dark"
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={t.radius.md}
      style={styles.appleButton}
      onPress={() => void signIn()}
    />
  );
}

export function OAuthButtons() {
  const t = useTheme();
  const [error, setError] = useState<string | null>(null);
  const showGoogle = GOOGLE_WEB_CLIENT_ID !== "";
  const showApple = Platform.OS === "ios";

  if (!showGoogle && !showApple) return null;

  return (
    <View style={{ marginTop: t.spacing.lg }}>
      <View style={styles.dividerRow}>
        <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginHorizontal: t.spacing.sm }]}>
          or
        </Text>
        <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
      </View>
      {showApple && <AppleButton onError={setError} />}
      {showGoogle && <GoogleButton onError={setError} />}
      <ErrorText message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth },
  appleButton: { height: 48, marginVertical: 6 },
});
