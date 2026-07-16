import { useRouter, type Href } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { Button, ErrorText } from "@/components/ui";
import { PlayerCard } from "@/components/PlayerCard";
import { SignInScreenCta } from "@/components/SignInCta";
import { useAuth } from "@/lib/auth-context";
import { useMeStats } from "@/lib/hooks";
import { buildProfileLink } from "@/lib/links";
import { useTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const { user, loading } = useAuth();
  const t = useTheme();
  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
      </View>
    );
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
      setShareError(e instanceof Error ? e.message : "Could not share your player card.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
      {user ? <PlayerCard user={user} stats={stats} innerRef={cardRef} /> : null}
      <Pressable
        onPress={() => void shareCard()}
        disabled={sharing}
        style={({ pressed }) => [
          styles.shareButton,
          {
            borderColor: t.colors.textPrimary,
            backgroundColor: pressed ? t.colors.surfaceMuted : "transparent",
            opacity: sharing ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[t.type.button, { color: t.colors.textPrimary }]}>
          {linkCopied ? "Link copied" : "Share player card"}
        </Text>
      </Pressable>
      <ErrorText message={shareError} />
      <Button
        title="Profile settings"
        variant="secondary"
        onPress={() => router.push("/profile-settings" as Href)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  shareButton: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginBottom: 16,
  },
});
