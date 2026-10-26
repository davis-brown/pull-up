// Explicit agreement to community terms and content-safety processing.
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export const TERMS_REQUIRED_MESSAGE = "Agree to the Terms of Service to create an account.";

function LegalLinks() {
  const t = useTheme();
  const router = useRouter();
  const link = [t.type.caption, { color: t.colors.accent }];
  return (
    <>
      <Text style={link} onPress={() => router.push("/terms")} accessibilityRole="link">
        Terms of Service
      </Text>
      {" and "}
      <Text style={link} onPress={() => router.push("/privacy")} accessibilityRole="link">
        Privacy Policy
      </Text>
    </>
  );
}

// Required checkbox on the register screen.
export function TermsCheckbox({
  accepted,
  onChange,
}: {
  accepted: boolean;
  onChange: (accepted: boolean) => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!accepted)}
      style={[styles.row, { marginBottom: t.spacing.md }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: accepted }}
      accessibilityLabel="I agree to the Terms of Service and Privacy Policy, zero tolerance for abusive content, and sending my public text to Cloudflare Workers AI for safety checks. Photos are reviewed by moderators before publication."
      hitSlop={6}
    >
      <Ionicons
        name={accepted ? "checkbox" : "square-outline"}
        size={22}
        color={accepted ? t.colors.accent : t.colors.textMuted}
      />
      <Text style={[t.type.caption, styles.text, { color: t.colors.textSecondary }]}>
        I agree to the <LegalLinks />. pull-up has zero tolerance for objectionable
        content or abusive behavior. I consent to public text I submit being sent
        to Cloudflare Workers AI for safety checks. Uploaded photos are reviewed
        by moderators before publication.
      </Text>
    </Pressable>
  );
}

// Passive notice where sign-in can also create an account (Apple / Google on
// the login screen).
export function TermsNotice() {
  const t = useTheme();
  return (
    <View style={{ marginTop: t.spacing.sm }}>
      <Text style={[t.type.caption, styles.center, { color: t.colors.textMuted }]}>
        By continuing, you agree to the <LegalLinks />. pull-up has zero tolerance
        for objectionable content or abusive behavior.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  text: { flex: 1 },
  center: { textAlign: "center" },
});
