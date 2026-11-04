import { useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

// Public page — also served by the web build, so this doubles as the
// Support URL required by the App Store listing (next to /privacy).

const SUPPORT_EMAIL = "contact@davisbrown.dev";

function Section({ title, children }: { title: string; children: string }) {
  const t = useTheme();
  return (
    <>
      <Text style={[t.type.heading, { color: t.colors.textPrimary, marginTop: t.spacing.lg }]}>
        {title}
      </Text>
      <Text style={[t.type.body, { color: t.colors.textSecondary, marginTop: t.spacing.xs }]}>
        {children}
      </Text>
    </>
  );
}

export default function SupportScreen() {
  const t = useTheme();
  const router = useRouter();
  const link = [t.type.bodyMedium, { color: t.colors.accent }];
  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg, maxWidth: 720, alignSelf: "center" }}
    >
      <Text style={[t.type.title, { color: t.colors.textPrimary }]}>Support</Text>
      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 4 }]}>
        pull-up · find live pickup basketball
      </Text>

      <Section title="Contact us">
        {"Questions, bug reports, or account requests — email us and include the email address on your account if it's about your account. Signed-in players can also use Profile → Profile settings → Send feedback."}
      </Section>
      <Pressable
        onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        hitSlop={6}
        accessibilityRole="link"
        style={{ marginTop: t.spacing.sm }}
      >
        <Text style={link}>{SUPPORT_EMAIL}</Text>
      </Pressable>

      <Section title="Report content or a player">
        {"Courts, uploaded photos, crowd reports, chat messages, planned runs, and player profiles each have a report option (the flag or \"…\" button). Moderators review reports and remove content or suspend accounts that break the Terms of Service. You can also block any player from their profile or from court chat; blocked players' messages, reports, and runs are hidden from you. Manage blocked players in Profile settings."}
      </Section>

      <Section title="Delete your account">
        {"In the app or on the web: Profile → Profile settings → Delete account. This permanently deletes your account and your data, as described in the Privacy Policy. If you can't sign in, email us from your account's address and we'll delete it for you."}
      </Section>

      <Section title="Location and auto check-in">
        {"Check-ins need your location only at the moment you check in. Auto check-in is optional and off by default; turn it off anytime in Profile settings → Auto check-in, or remove the \"Always\" location permission in your device settings."}
      </Section>

      <Section title="Notifications">
        {"Court alerts and streak reminders can be turned off in Profile settings, and all notifications can be turned off in your device settings."}
      </Section>

      <View style={{ flexDirection: "row", gap: t.spacing.lg, marginTop: t.spacing.xl }}>
        <Pressable onPress={() => router.push("/privacy")} hitSlop={8} accessibilityRole="link">
          <Text style={link}>Privacy Policy</Text>
        </Pressable>
        <Pressable onPress={() => router.push("/terms")} hitSlop={8} accessibilityRole="link">
          <Text style={link}>Terms of Service</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
