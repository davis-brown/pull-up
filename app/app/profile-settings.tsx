import { useFocusEffect, useRouter, type Href } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar } from "@/components/Avatar";
import { Button, Card, Chip, ErrorText, Field, FullScreenLoader } from "@/components/ui";
import { SignInScreenCta } from "@/components/SignInCta";
import { api } from "@/lib/api";
import { deviceTimezone } from "@/lib/push-registration";
import { useAuth } from "@/lib/auth-context";
import { getErrorMessage } from "@/lib/errors";
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
  useSetBlocked,
  useUploadAvatar,
} from "@/lib/hooks";
import {
  AVAILABILITY_WINDOWS,
  MAX_STYLE_TAGS,
  POSITIONS,
  SKILL_LEVELS,
  STYLE_TAGS,
  formatHeight,
} from "@/lib/player";
import { formatClockTime } from "@/lib/relative-time";
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

export default function ProfileSettingsScreen() {
  const { user, loading } = useAuth();
  if (loading) {
    return <FullScreenLoader />;
  }
  if (!user) {
    return (
      <SignInScreenCta message="Sign in to see your check-ins, manage favorites, and set up auto check-in." />
    );
  }
  return <ProfileSettingsContent />;
}

function ProfileSettingsContent() {
  const { user, signOut, refreshUser } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();
  const uploadAvatar = useUploadAvatar();
  const clearAvatar = useClearAvatar();
  const [nameDraft, setNameDraft] = useState(user?.display_name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const initialJersey = user?.jersey_number != null ? String(user.jersey_number) : "";
  const initialHeight = user?.height_cm != null ? String(user.height_cm) : "";
  const [jerseyDraft, setJerseyDraft] = useState(initialJersey);
  const [positionDraft, setPositionDraft] = useState<string | null>(user?.position ?? null);
  const [heightDraft, setHeightDraft] = useState(initialHeight);
  const [styleTagsDraft, setStyleTagsDraft] = useState<string[]>(user?.style_tags ?? []);
  const [skillDraft, setSkillDraft] = useState<string | null>(user?.skill_level ?? null);
  const [availabilityDraft, setAvailabilityDraft] = useState<string[]>(user?.availability ?? []);
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
      setProfileError(getErrorMessage(e, "Could not update privacy."));
    }
  };

  const toggleWindowAlerts = async (next: boolean) => {
    setProfileError(null);
    try {
      // Turning alerts on re-reports the device timezone: users who
      // registered their push token before phase 16 have none on file.
      await api<User>("/me", {
        method: "PATCH",
        body: JSON.stringify({
          window_alerts_enabled: next,
          ...(next ? { timezone: deviceTimezone() } : {}),
        }),
      });
      await refreshUser();
    } catch (e) {
      setProfileError(getErrorMessage(e, "Could not update alerts."));
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
      setProfileError(getErrorMessage(e, "Could not save your name."));
    } finally {
      setSavingName(false);
    }
  };

  const detailsChanged =
    jerseyDraft !== initialJersey ||
    positionDraft !== (user?.position ?? null) ||
    heightDraft !== initialHeight ||
    styleTagsDraft.join(",") !== (user?.style_tags ?? []).join(",") ||
    skillDraft !== (user?.skill_level ?? null) ||
    availabilityDraft.join(",") !== (user?.availability ?? []).join(",");

  // Server clamps height_cm to 120-250 (400s outside that range) — validate
  // the same bound client-side so the save button reflects it instead of
  // round-tripping to a guaranteed error.
  const heightOutOfRange =
    heightDraft.trim() !== "" && (Number(heightDraft) < 120 || Number(heightDraft) > 250);

  const saveDetails = async () => {
    if (heightOutOfRange) return;
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
          skill_level: skillDraft,
          availability: availabilityDraft,
        }),
      });
      await refreshUser();
    } catch (e) {
      setProfileError(getErrorMessage(e, "Could not save your player details."));
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

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
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

          <Text style={[t.type.label, { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.xs + 2 }]}>
            Skill level
          </Text>
          <View style={styles.chips}>
            {SKILL_LEVELS.map((s) => (
              <Chip
                key={s.key}
                label={s.label}
                selected={skillDraft === s.key}
                onPress={() => setSkillDraft(skillDraft === s.key ? null : s.key)}
              />
            ))}
          </View>

          <Text style={[t.type.label, { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.xs + 2 }]}>
            When you usually play
          </Text>
          <View style={styles.chips}>
            {AVAILABILITY_WINDOWS.map((w) => (
              <Chip
                key={w.key}
                label={w.label}
                selected={availabilityDraft.includes(w.key)}
                onPress={() =>
                  setAvailabilityDraft((prev) =>
                    prev.includes(w.key) ? prev.filter((k) => k !== w.key) : [...prev, w.key],
                  )
                }
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
          {heightDraft.trim() && !heightOutOfRange ? (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: -4, marginBottom: t.spacing.sm }]}>
              {formatHeight(Number(heightDraft))}
            </Text>
          ) : null}
          {heightOutOfRange ? <ErrorText message="Height must be 120-250 cm" /> : null}

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

          {detailsChanged && !heightOutOfRange ? (
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
        <Pressable
          onPress={() => void toggleWindowAlerts(!(user?.window_alerts_enabled ?? true))}
          style={[styles.privacyRow, { borderTopColor: t.colors.border }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>Court alerts</Text>
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
              Get pinged when a favorite court has a run going during one of your windows.
            </Text>
          </View>
          <Text
            style={[
              t.type.bodyMedium,
              { color: (user?.window_alerts_enabled ?? true) ? t.colors.accent : t.colors.textMuted },
            ]}
          >
            {(user?.window_alerts_enabled ?? true) ? "On" : "Off"}
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
            Expires at {formatClockTime(checkIn.expires_at)}
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

      <Button
        title="Send feedback"
        variant="secondary"
        onPress={() =>
          router.push(`/flag?entityType=feedback&entityId=${user?.id ?? ""}` as Href)
        }
      />

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
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 },
  avatarActions: { gap: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: -8 },
  chipDisabled: { opacity: 0.4 },
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
