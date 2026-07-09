import { ScrollView, Text } from "react-native";
import { useTheme } from "@/lib/theme";

// Public page — also served by the web build, so this doubles as the
// privacy-policy URL required by the App Store / Play Store listings.

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

export default function PrivacyScreen() {
  const t = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg, maxWidth: 720, alignSelf: "center" }}
    >
      <Text style={[t.type.title, { color: t.colors.textPrimary }]}>Privacy Policy</Text>
      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 4 }]}>
        Effective July 8, 2026 · pull-up
      </Text>

      <Section title="What we collect">
        {"Account: your email address, display name, and a securely hashed password — or, if you sign in with Google or Apple, the identity those providers share with us.\n\n" +
          "Check-ins: when you check in at a court, we store which court, the time, and your reported distance from it. Your exact coordinates are used to verify you're at the court and are not used to build a movement history.\n\n" +
          "Optional auto check-in: if you turn it on, your device watches for arrivals at nearby courts using low-power region monitoring. The only thing created is a check-in at a known court. It is off by default and can be turned off anytime in your profile.\n\n" +
          "Content you post: court submissions, photos, crowd reports, chat messages, and planned runs are visible to other users with your display name.\n\n" +
          "Push token: if you enable notifications, we store a device token so we can deliver them."}
      </Section>

      <Section title="What we don't do">
        {"We don't sell your data, show ads, track you across other apps or websites, or store continuous location history. Location is only ever used at the moment of a check-in or court arrival."}
      </Section>

      <Section title="Services we rely on">
        {"Hosting and photo storage run on Cloudflare; the database is hosted by Neon. Push notifications are delivered through Expo's push service. Court locations come from OpenStreetMap; missing addresses are looked up via the Nominatim geocoding service using the court's coordinates (never your identity). Court photos may be displayed from Wikimedia Commons. If you sign in with Google or Apple, their privacy policies also apply to that sign-in. If the app crashes, a crash report (device model, OS version, and the error's stack trace — never your location or identity) is sent to Sentry so we can fix the bug."}
      </Section>

      <Section title="Deleting your account">
        {"You can delete your account anytime in Profile → Delete account (in the app or on the web). This permanently removes your account, check-ins, messages, reports, photos, favorites, and push tokens. Courts you submitted remain (they're community data) with your identity removed."}
      </Section>

      <Section title="Contact">
        {"Questions or requests: contact@davisbrown.dev"}
      </Section>

      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.xl }]}>
        Court data © OpenStreetMap contributors (ODbL). Map tiles by OpenFreeMap.
      </Text>
    </ScrollView>
  );
}
