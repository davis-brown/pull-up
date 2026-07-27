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
        Effective July 20, 2026 · pull-up
      </Text>

      <Section title="What we collect">
        {"Account: your verified email address, display name, and a securely hashed password — or, if you sign in with Google or Apple, the identity those providers share with us.\n\n" +
           "Nearby courts: when you allow location access, your current coordinates are used transiently to rank nearby courts. They are not retained as location history.\n\n" +
          "Area search: when you submit a neighborhood, city, or other area search, the words you entered and an approximate map-area bias are sent transiently to OpenStreetMap's Nominatim service. We do not attach your account identity or retain a search history.\n\n" +
          "Check-ins: when you check in at a court, we store which court, the time, and your reported distance from it. Your exact coordinates are used only to calculate that distance and are discarded.\n\n" +
          "Optional auto check-in: if you turn it on, your device watches for arrivals at nearby courts using low-power region monitoring. The only thing created is a check-in at a known court. It is off by default and can be turned off anytime in your profile.\n\n" +
          "Content you post: court submissions, photos, crowd reports, chat messages, planned runs, court-condition confirmations, and \"looking to play\" posts are visible to other users with your display name.\n\n" +
          "Profile details you choose to add: jersey number, position, height, playing style, skill level, and the times of week you're usually free. These are optional, shown on your public profile, and editable or removable at any time.\n\n" +
          "Game results: when someone records a pickup game, it names the players on both sides — so another player can add you to a game, and other people will see it. A recorded game stays private to its participants until someone on the losing side confirms it; unconfirmed games are deleted after 48 hours. Confirmed games are public and count toward your win-loss record.\n\n" +
          "Activity level: we keep a running count of experience points and a level derived from how often you play, plus the weeks you've checked in. Your level is shown on your public profile (hidden from non-followers if your account is private).\n\n" +
          "Push token and time zone: if you enable notifications, we store a device token so we can deliver them, and your device's time zone so reminders arrive at a sensible hour where you are. We store the zone name (for example \"America/Chicago\"), not your location."}
      </Section>

      <Section title="What we don't do">
        {"We don't sell your data, show ads, track you across other apps or websites, or store continuous location history. Location is used only for nearby-court searches, check-in verification, and optional court-arrival detection."}
      </Section>

      <Section title="Services we rely on">
        {"Hosting, transactional verification email, and photo storage run on Cloudflare; the database is hosted by Neon. Push notifications are delivered through Expo's push service. Court locations come from OpenStreetMap; Nominatim looks up missing court addresses and explicit area-search terms (never your identity). Court photos may be displayed from Wikimedia Commons. If you sign in with Google or Apple, their privacy policies also apply to that sign-in. If the app crashes, a sanitized crash report (device model, OS version, and error stack trace, with request queries and identifiers removed) is sent to Sentry so we can fix the bug."}
      </Section>

      <Section title="Deleting your account">
        {"You can delete your account anytime in Profile → Profile settings → Delete account (in the app or on the web). This permanently removes your account, check-ins, messages, reports, photos, favorites, push tokens, profile details, experience points, \"looking to play\" posts, and your part in any recorded games. Courts you submitted remain (they're community data) with your identity removed."}
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
