import { useRouter, type Href } from "expo-router";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import {
  Platform,
  ScrollView,
  View,
} from "react-native";
import { captureRef } from "react-native-view-shot";
import { Button, ErrorText, FullScreenLoader } from "@/components/ui";
import { PlayerCard } from "@/components/PlayerCard";
import { SignInScreenCta } from "@/components/SignInCta";
import { useAuth } from "@/lib/auth-context";
import { getErrorMessage } from "@/lib/errors";
import { useMeStats } from "@/lib/hooks";
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
      {user ? <PlayerCard user={user} stats={stats} innerRef={cardRef} /> : null}
      <View style={{ marginTop: t.spacing.sm }}>
        <Button
          title={linkCopied ? "Link copied" : "Share player card"}
          busy={sharing}
          onPress={() => void shareCard()}
        />
      </View>
      <ErrorText message={shareError} />
      <Button
        title="Profile settings"
        variant="secondary"
        onPress={() => router.push("/profile-settings" as Href)}
      />
    </ScrollView>
  );
}
