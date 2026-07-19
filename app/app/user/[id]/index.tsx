import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { GetTheAppBanner } from "@/components/GetTheAppBanner";
import { QueryError } from "@/components/QueryError";
import { SignInAction } from "@/components/SignInCta";
import { Button, Card, ErrorText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useProfile, useSetFollow } from "@/lib/hooks";
import { parseRouteId, safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const params = useLocalSearchParams();
  const id = parseRouteId(params.id);
  const router = useRouter();
  const t = useTheme();
  const { user } = useAuth();
  const { data: profile, isLoading, error, refetch } = useProfile(id);
  const setFollow = useSetFollow(id ?? "");
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (!id) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={new Error("Invalid user id")} title="Invalid player link" message="This player link is not valid." />
      </View>
    );
  }

  if (error && !profile) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={error} onRetry={() => void refetch()} />
      </View>
    );
  }
  if (isLoading || !profile) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
      </View>
    );
  }

  const isSelf = user?.id === profile.id;
  const isPrivateLocked = profile.is_private && !isSelf && !profile.is_following;
  const memberSince = new Date(profile.member_since).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
      {/* Shared player-card links land here on web: give non-users an
          install path (component no-ops on native and when dismissed). */}
      <GetTheAppBanner />
      <View style={styles.header}>
        <Avatar avatarUrl={profile.avatar_url} displayName={profile.display_name} seed={profile.id} size={72} />
        <Text
          style={[
            t.type.displayCondensed,
            { color: t.colors.textPrimary, marginTop: t.spacing.sm, textAlign: "center" },
          ]}
        >
          {profile.display_name}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 2 }]}>
          {profile.reputation} rep · since {memberSince}
          {profile.follows_you ? "  ·  Follows you" : ""}
        </Text>
      </View>

      {isPrivateLocked ? (
        <Card>
          <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary, textAlign: "center" }]}>
            This account is private
          </Text>
          <Text style={[t.type.caption, { color: t.colors.textSecondary, textAlign: "center", marginTop: 4 }]}>
            Follow to see their check-ins, courts, and streak.
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.statRow}>
              <Stat label="Check-ins" value={profile.check_in_count} />
              <Stat label="Courts added" value={profile.courts_added_count} />
              <Stat label="Day streak" value={profile.streak_days} />
            </View>
          </Card>

          <View style={styles.countRow}>
            <Pressable style={styles.countItem} onPress={() => router.push(`/user/${safePathSegment(id)}/followers` as Href)}>
              <Text style={[t.type.heading, { color: t.colors.textPrimary }]}>{profile.follower_count}</Text>
              <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Followers</Text>
            </Pressable>
            <Pressable style={styles.countItem} onPress={() => router.push(`/user/${safePathSegment(id)}/following` as Href)}>
              <Text style={[t.type.heading, { color: t.colors.textPrimary }]}>{profile.following_count}</Text>
              <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Following</Text>
            </Pressable>
          </View>
        </>
      )}

      <View style={{ marginTop: t.spacing.md }}>
        {isSelf ? (
          <Button title="Edit profile" variant="secondary" onPress={() => router.push("/profile-settings" as Href)} />
        ) : !user ? (
          <SignInAction label="Sign in to follow" />
        ) : (
          <Button
            title={profile.is_following ? "Following" : profile.has_requested ? "Requested" : profile.is_private ? "Request to follow" : "Follow"}
            variant={profile.is_following || profile.has_requested ? "secondary" : "primary"}
            busy={setFollow.isPending}
            onPress={() => {
              setMutationError(null);
              setFollow.mutate(
                !(profile.is_following || profile.has_requested),
                { onError: (e) => setMutationError(e.message) },
              );
            }}
          />
        )}
        <ErrorText message={mutationError} />
        {!isSelf && (
          <Pressable
            onPress={() => router.push(`/flag?entityType=user&entityId=${safePathSegment(id)}` as Href)}
            style={styles.reportRow}
            hitSlop={8}
          >
            <Ionicons name="flag-outline" size={16} color={t.colors.textMuted} />
            <Text style={[t.type.caption, { color: t.colors.textMuted }]}>Report</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const t = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[t.type.title, { color: t.colors.textPrimary }]}>{value}</Text>
      <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", marginBottom: 16 },
  statRow: { flexDirection: "row", justifyContent: "space-around" },
  stat: { alignItems: "center" },
  countRow: { flexDirection: "row", justifyContent: "space-around", marginTop: 12 },
  countItem: { alignItems: "center", paddingVertical: 8, paddingHorizontal: 24 },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", marginTop: 12 },
});
