import { ScrollView, Text } from "react-native";
import { useTheme } from "@/lib/theme";

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

export default function TermsScreen() {
  const t = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg, maxWidth: 720, alignSelf: "center" }}
    >
      <Text style={[t.type.title, { color: t.colors.textPrimary }]}>Terms of Service</Text>
      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 4 }]}>
        Effective July 8, 2026 · pull-up
      </Text>

      <Section title="The service">
        {"pull-up helps people find pickup basketball: a community map of courts, live check-ins, crowd reports, planned runs, and court chat. It's provided as-is; we may change or discontinue features at any time."}
      </Section>

      <Section title="Your content and conduct">
        {"You own what you post and give us a license to display it within the service. Don't post content that is abusive, hateful, illegal, deceptive, or spam; don't harass other players; don't submit fake courts or false check-ins. You can report any content with the flag button and block any user; moderators may remove content or suspend accounts that break these rules — there is zero tolerance for objectionable content or abusive behavior."}
      </Section>

      <Section title="Play at your own risk">
        {"pull-up shows crowd-sourced information about public places. We don't verify courts, conditions, or the people at them. Showing up, playing, and anything that happens at a court is your own responsibility. Court data may be inaccurate or out of date."}
      </Section>

      <Section title="Location features">
        {"Check-in verification and optional auto check-in use your device's location as described in the Privacy Policy. Auto check-in is opt-in and can be disabled anytime."}
      </Section>

      <Section title="Accounts">
        {"You're responsible for your account and keeping your credentials safe. You can delete your account anytime in Profile → Delete account. We may terminate accounts that violate these terms."}
      </Section>

      <Section title="Attribution">
        {"Court data © OpenStreetMap contributors, licensed under the ODbL. Map tiles by OpenFreeMap. Some photos are from Wikimedia Commons under their stated licenses."}
      </Section>

      <Section title="Contact">
        {"Questions: contact@davisbrown.dev"}
      </Section>
    </ScrollView>
  );
}
