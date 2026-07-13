import { useFocusEffect, useRouter, type Href } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useCallback, useRef, useState } from "react";
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
import { Avatar } from "@/components/Avatar";
import { Button, Card, Chip, ErrorText, Field } from "@/components/ui";
import { PlayerCard } from "@/components/PlayerCard";
import { SignInScreenCta } from "@/components/SignInCta";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  geofencingSupported,
  getGeofenceMode,
  setGeofenceMode,
  type GeofenceMode,
} from "@/lib/geofencing";
import {
  useBlockedUsers,
  useCheckInHistory,
  useCheckOut,
  useClearAvatar,
  useCurrentCheckIn,
  useDeleteAccount,
  useFollowRequests,
  useMeStats,
  useSetBlocked,
  useUploadAvatar,
} from "@/lib/hooks";
import { buildProfileLink } from "@/lib/links";
import { MAX_STYLE_TAGS, POSITIONS, STYLE_TAGS, formatHeight } from "@/lib/player";
import { useTheme, useThemePreference, type ThemePreference } from "@/lib/theme";
import type { User } from "@/lib/types";

const appearanceOptions: Array<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const geofenceOptions: Array<{ value: GeofenceMode; label: string }> = [
  { value: "off", label: "Off" },
  { value: "prompt", label: "Ask me" },
  { value: "auto", label: "Automatic" },
];

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
  const { user, signOut, refreshUser } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();
  const uploadAvatar = useUploadAvatar();
  const clearAvatar = useClearAvatar();
  const [nameDraft, setNameDraft] = useState(user?.display_name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const { data: stats } = useMeStats();
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const initialJersey = user?.jersey_number != null ? String(user.jersey_number) : "";
  const initialHeight = user?.height_cm != null ? String(user.height_cm) : "";
  const [jerseyDraft, setJerseyDraft] = useState(initialJersey);
  const [positionDraft, setPositionDraft] = useState<string | null>(user?.position ?? null);
  const [heightDraft, setHeightDraft] = useState(initialHeight);
  const [styleTagsDraft, setStyleTagsDraft] = useState<string[]>(user?.style_tags ?? []);
  const [savingDetails, setSavingDetails] = useState(false);
  const { data } = useCurrentCheckIn();
  const checkOut = useCheckOut();
  const checkIn = data?.check_in ?? null;
  const [geoMode, setGeoMode] = useState<GeofenceMode>("off");
  const [geoError, setGeoError] = useState<string | null>(null);
  const { data: history } = useCheckInHistory();
  const { data: blocked } = useBlockedUsers();
  const setBlocked = useSetBlocked();
  const deleteAccount = useDeleteAccount();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data: followRequests } = useFollowRequests();

  const togglePrivate = async (next: boolean) => {
    setProfileError(null);
    try {
      await api<User>("/me", { method: "PATCH", body: JSON.stringify({ is_private: next }) });
      await refreshUser();
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Could not update privacy.");
    }
  };

  // Re-read on focus: the disclosure modal may have changed the mode.
  useFocusEffect(
    useCallback(() => {
      void getGeofenceMode().then(setGeoMode);
    }, []),
  );

  const changeGeoMode = async (mode: GeofenceMode) => {
    setGeoError(null);
    // Enabling from Off requires the prominent background-location
    // disclosure first; the modal performs the actual enable.
    if (mode !== "off" && geoMode === "off") {
      router.push(`/location-disclosure?mode=${mode}`);
      return;
    }
    const result = await setGeofenceMode(mode);
    if (result.ok) {
      setGeoMode(mode);
    } else {
      setGeoError(result.reason ?? "Could not enable auto check-in.");
    }
  };

  const doDeleteAccount = () => {
    setDeleteError(null);
    deleteAccount.mutate(undefined, {
      onSuccess: () => void signOut(),
      onError: (e) => setDeleteError(e.message),
    });
  };

  const changePhoto = async () => {
    setProfileError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    uploadAvatar.mutate(
      { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" },
      { onSuccess: () => void refreshUser(), onError: (e) => setProfileError(e.message) },
    );
  };

  const removePhoto = () => {
    setProfileError(null);
    clearAvatar.mutate(undefined, {
      onSuccess: () => void refreshUser(),
      onError: (e) => setProfileError(e.message),
    });
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name || name === user?.display_name) return;
    setProfileError(null);
    setSavingName(true);
    try {
      await api<User>("/me", { method: "PATCH", body: JSON.stringify({ display_name: name }) });
      await refreshUser();
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Could not save your name.");
    } finally {
      setSavingName(false);
    }
  };

  const detailsChanged =
    jerseyDraft !== initialJersey ||
    positionDraft !== (user?.position ?? null) ||
    heightDraft !== initialHeight ||
    styleTagsDraft.join(",") !== (user?.style_tags ?? []).join(",");

  const saveDetails = async () => {
    setProfileError(null);
    setSavingDetails(true);
    try {
      await api<User>("/me", {
        method: "PATCH",
        body: JSON.stringify({
          jersey_number: jerseyDraft.trim() === "" ? null : Number(jerseyDraft),
          position: positionDraft,
          height_cm: heightDraft.trim() === "" ? null : Number(heightDraft),
          style_tags: styleTagsDraft,
        }),
      });
      await refreshUser();
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Could not save your player details.");
    } finally {
      setSavingDetails(false);
    }
  };

  const toggleStyleTag = (key: string) => {
    setStyleTagsDraft((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_STYLE_TAGS) return prev;
      return [...prev, key];
    });
  };

  const shareCard = async () => {
    if (!user) return;
    setProfileError(null);
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(buildProfileLink(user.id));
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      } catch {
        setProfileError("Could not copy your profile link.");
      }
      return;
    }
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 0.9 });
      await Sharing.shareAsync(uri);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Could not share your player card.");
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

      <Card>
        <View style={styles.avatarRow}>
          <Avatar
            avatarUrl={user?.avatar_url ?? null}
            displayName={user?.display_name ?? ""}
            seed={user?.id ?? ""}
            size={64}
          />
          <View style={styles.avatarActions}>
            <Pressable onPress={() => void changePhoto()} hitSlop={6} disabled={uploadAvatar.isPending}>
              <Text style={[t.type.caption, { color: t.colors.accent }]}>
                {uploadAvatar.isPending ? "Uploading…" : "Change photo"}
              </Text>
            </Pressable>
            {user?.avatar_url ? (
              <Pressable onPress={removePhoto} hitSlop={6} disabled={clearAvatar.isPending}>
                <Text style={[t.type.caption, { color: t.colors.textMuted }]}>Remove photo</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Field
          label="Display name"
          value={nameDraft}
          onChangeText={setNameDraft}
          autoCapitalize="words"
          maxLength={40}
          placeholder="Your name"
        />
        {nameDraft.trim() && nameDraft.trim() !== user?.display_name ? (
          <Button title="Save name" variant="secondary" busy={savingName} onPress={() => void saveName()} />
        ) : null}
        <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.sm }]}>
          {user?.email}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
          Reputation {user?.reputation ?? 0}
        </Text>

        <View style={[styles.detailsSection, { borderTopColor: t.colors.border }]}>
          <Field
            label="Jersey number"
            value={jerseyDraft}
            onChangeText={(v) => setJerseyDraft(v.replace(/[^0-9]/g, "").slice(0, 2))}
            keyboardType="number-pad"
            placeholder="0-99"
          />

          <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.xs + 2 }]}>
            Position
          </Text>
          <View style={styles.chips}>
            {POSITIONS.map((p) => (
              <Chip
                key={p.key}
                label={p.label}
                selected={positionDraft === p.key}
                onPress={() => setPositionDraft(positionDraft === p.key ? null : p.key)}
              />
            ))}
          </View>

          <Field
            label="Height (cm)"
            value={heightDraft}
            onChangeText={(v) => setHeightDraft(v.replace(/[^0-9]/g, "").slice(0, 3))}
            keyboardType="number-pad"
            placeholder="e.g. 185"
          />
          {heightDraft.trim() ? (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: -4, marginBottom: t.spacing.sm }]}>
              {formatHeight(Number(heightDraft))}
            </Text>
          ) : null}

          <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.xs + 2 }]}>
            Style tags (up to {MAX_STYLE_TAGS})
          </Text>
          <View style={styles.chips}>
            {STYLE_TAGS.map((s) => {
              const selected = styleTagsDraft.includes(s.key);
              const atCap = !selected && styleTagsDraft.length >= MAX_STYLE_TAGS;
              return (
                <View key={s.key} style={atCap ? styles.chipDisabled : undefined}>
                  <Chip label={s.label} selected={selected} onPress={() => toggleStyleTag(s.key)} />
                </View>
              );
            })}
          </View>

          {detailsChanged ? (
            <Button
              title="Save player details"
              variant="secondary"
              busy={savingDetails}
              onPress={() => void saveDetails()}
            />
          ) : null}
        </View>

        <ErrorText message={profileError} />
        <Pressable
          onPress={() => void togglePrivate(!user?.is_private)}
          style={[styles.privacyRow, { borderTopColor: t.colors.border }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>Private account</Text>
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
              New followers must be approved; non-followers can't see your activity.
            </Text>
          </View>
          <Text style={[t.type.bodyMedium, { color: user?.is_private ? t.colors.accent : t.colors.textMuted }]}>
            {user?.is_private ? "On" : "Off"}
          </Text>
        </Pressable>
      </Card>

      {(followRequests?.length ?? 0) > 0 && (
        <Button
          title={`Follow requests (${followRequests!.length})`}
          variant="secondary"
          onPress={() => router.push("/follow-requests" as Href)}
        />
      )}

      {checkIn && (
        <Card>
          <View style={styles.liveRow}>
            <View style={[styles.liveDot, { backgroundColor: t.colors.live }]} />
            <Text style={[t.type.label, { color: t.colors.live }]}>Checked in</Text>
          </View>
          <Text style={[t.type.heading, { color: t.colors.textPrimary, marginTop: t.spacing.xs }]}>
            {checkIn.court_name ?? "A court"}
          </Text>
          <Text
            style={[
              t.type.caption,
              { color: t.colors.textSecondary, marginTop: 2, marginBottom: t.spacing.sm },
            ]}
          >
            Expires at{" "}
            {new Date(checkIn.expires_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Button
            title="Check out"
            variant="secondary"
            busy={checkOut.isPending}
            onPress={() =>
              checkOut.mutate(undefined, {
                onSuccess: () => router.push(`/court/${checkIn.court_id}`),
              })
            }
          />
        </Card>
      )}

      <Card>
        <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
          Appearance
        </Text>
        <View style={styles.chips}>
          {appearanceOptions.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={preference === option.value}
              onPress={() => setPreference(option.value)}
            />
          ))}
        </View>
      </Card>

      {geofencingSupported && (
        <Card>
          <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
            Auto check-in
          </Text>
          <Text
            style={[t.type.caption, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}
          >
            Detect when you arrive at a court. "Ask me" sends a one-tap prompt;
            "Automatic" checks you in and out on its own. Uses low-power region
            monitoring — your location history is never stored.
          </Text>
          <View style={styles.chips}>
            {geofenceOptions.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={geoMode === option.value}
                onPress={() => void changeGeoMode(option.value)}
              />
            ))}
          </View>
          <ErrorText message={geoError} />
        </Card>
      )}

      {(history?.length ?? 0) > 0 && (
        <Card>
          <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.xs }]}>
            Where you've played
          </Text>
          {history!.slice(0, 10).map((h) => (
            <Pressable
              key={h.id}
              onPress={() => router.push(`/court/${h.court_id}`)}
              style={[styles.historyRow, { borderTopColor: t.colors.border }]}
            >
              <Text
                style={[t.type.bodyMedium, styles.historyName, { color: t.colors.textPrimary }]}
                numberOfLines={1}
              >
                {h.court_name}
              </Text>
              <Text style={[t.type.caption, { color: t.colors.textMuted }]}>
                {new Date(h.created_at).toLocaleDateString([], {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </Pressable>
          ))}
        </Card>
      )}

      {user?.is_admin && (
        <Button
          title="Moderation queue"
          variant="secondary"
          onPress={() => router.push("/admin")}
        />
      )}

      {(blocked?.length ?? 0) > 0 && (
        <Card>
          <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.xs }]}>
            Blocked users
          </Text>
          {blocked!.map((b) => (
            <View key={b.blocked_id} style={[styles.blockedRow, { borderTopColor: t.colors.border }]}>
              <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]} numberOfLines={1}>
                {b.display_name}
              </Text>
              <Pressable
                onPress={() => setBlocked.mutate({ userId: b.blocked_id, blocked: false })}
                hitSlop={8}
                disabled={setBlocked.isPending}
              >
                <Text style={[t.type.caption, { color: t.colors.accent }]}>Unblock</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Card>
        <View style={styles.legalRow}>
          <Pressable onPress={() => router.push("/privacy")} hitSlop={8}>
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Privacy Policy</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/terms")} hitSlop={8}>
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Terms of Service</Text>
          </Pressable>
        </View>
      </Card>

      <Button title="Sign out" variant="danger" onPress={() => void signOut()} />

      {confirmingDelete ? (
        <Card tone="warning">
          <Text style={[t.type.label, { color: t.colors.warning }]}>Delete account?</Text>
          <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.xs, marginBottom: t.spacing.sm }]}>
            This permanently deletes your account, check-ins, messages, photos,
            and favorites. Courts you added stay on the map without your name.
            This cannot be undone.
          </Text>
          <ErrorText message={deleteError} />
          <Button
            title="Yes, delete my account forever"
            variant="danger"
            busy={deleteAccount.isPending}
            onPress={doDeleteAccount}
          />
          <Button title="Keep my account" variant="ghost" onPress={() => setConfirmingDelete(false)} />
        </Card>
      ) : (
        <Pressable onPress={() => setConfirmingDelete(true)} hitSlop={8}>
          <Text style={[t.type.caption, styles.deleteLink, { color: t.colors.textMuted }]}>
            Delete account
          </Text>
        </Pressable>
      )}

      <Text
        style={[
          t.type.caption,
          styles.attribution,
          { color: t.colors.textMuted, marginTop: t.spacing.xl },
        ]}
      >
        Court data © OpenStreetMap contributors (ODbL) and pull-up users.{"\n"}
        Map tiles by OpenFreeMap, © OpenStreetMap contributors.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 },
  avatarActions: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: -8 },
  chipDisabled: { opacity: 0.4 },
  shareButton: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginBottom: 16,
  },
  detailsSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 12,
    paddingTop: 12,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  historyName: { flex: 1 },
  blockedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  legalRow: { flexDirection: "row", justifyContent: "space-around" },
  deleteLink: { textAlign: "center", marginTop: 14, textDecorationLine: "underline" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  attribution: { textAlign: "center", lineHeight: 18 },
  privacyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
});
