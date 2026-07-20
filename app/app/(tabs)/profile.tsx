import { useRouter, type Href } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { Button, Card, ErrorText, FullScreenLoader, Overline } from "@/components/ui";
import { BadgeCelebration } from "@/components/BadgeCelebration";
import { LevelUpCelebration } from "@/components/LevelUpCelebration";
import { PlayerCard } from "@/components/PlayerCard";
import { SignInScreenCta } from "@/components/SignInCta";
import { useAuth } from "@/lib/auth-context";
import { getErrorMessage } from "@/lib/errors";
import { useAckBadges, useAckLevelUp, useMeStats } from "@/lib/hooks";
import { XP_SOURCES } from "@/lib/levels";
import { buildProfileLink } from "@/lib/links";
import { useTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const { user, loading } = useAuth();
  if (loading) {
    return <FullScreenLoader />;
  }
  if (!user) {
    return (
      <SignInScreenCta message="Sign in to see your check-ins, manage favorites, and set up auto check-in." />
    );
  }
  return <ProfileContent />;
}

function ProfileContent() {
  const { user } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const { data: stats } = useMeStats();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // Level-up celebration. Tracking the level already celebrated locally
  // means dismissing hides it immediately rather than waiting on the ack
  // round-trip, and a failed ack can't re-open it on this screen.
  const ackLevelUp = useAckLevelUp();
  const [celebrated, setCelebrated] = useState<number | null>(null);
  const pendingLevel = stats?.level_up_pending ?? null;
  const celebrationLevel = pendingLevel !== celebrated ? pendingLevel : null;
  const dismissLevelUp = () => {
    setCelebrated(pendingLevel);
    ackLevelUp.mutate();
  };

  // New badges, shown AFTER any level-up rather than stacked on top of it:
  // a check-in that levels a player often earns a badge in the same breath,
  // and two modals at once reads as a bug.
  const ackBadges = useAckBadges();
  const [badgesCelebrated, setBadgesCelebrated] = useState(false);
  const newBadges = stats?.new_badges ?? [];
  const badgeSlugs =
    celebrationLevel === null && !badgesCelebrated ? newBadges : [];
  const dismissBadges = () => {
    setBadgesCelebrated(true);
    ackBadges.mutate();
  };

  const shareCard = async () => {
    if (!user) return;
    setShareError(null);
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(buildProfileLink(user.id));
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      } catch {
        setShareError("Could not copy your profile link.");
      }
      return;
    }
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 0.9 });
      await Sharing.shareAsync(uri);
    } catch (e) {
      setShareError(getErrorMessage(e, "Could not share your player card."));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
      <LevelUpCelebration
        level={celebrationLevel}
        tier={stats?.tier}
        onDismiss={dismissLevelUp}
      />
      <BadgeCelebration slugs={badgeSlugs} onDismiss={dismissBadges} />
      {user ? <PlayerCard user={user} stats={stats} innerRef={cardRef} /> : null}
      <View style={{ marginTop: t.spacing.sm }}>
        <Button
          title={linkCopied ? "Link copied" : "Share player card"}
          busy={sharing}
          onPress={() => void shareCard()}
        />
      </View>
      <ErrorText message={shareError} />
      <Card>
        <Overline>How you earn XP</Overline>
        {XP_SOURCES.map((src) => (
          <View key={src.label} style={styles.xpRow}>
            <Text style={[t.type.caption, { color: t.colors.textSecondary, flex: 1 }]}>
              {src.label}
            </Text>
            <Text style={[t.type.caption, { fontFamily: t.fonts.bodySemi, color: t.colors.accent }]}>
              {src.points}
            </Text>
          </View>
        ))}
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          Capped at 75 XP a day, and repeat check-ins at the same court don't
          stack — levels track playing, not tapping.
        </Text>
      </Card>
      <Button
        title="Profile settings"
        variant="secondary"
        onPress={() => router.push("/profile-settings" as Href)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  xpRow: { flexDirection: "row", alignItems: "baseline", gap: 12, marginTop: 6 },
});
