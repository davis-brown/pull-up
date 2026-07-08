import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Chip, ErrorText } from "@/components/ui";
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
  useCurrentCheckIn,
  useDeleteAccount,
  useSetBlocked,
} from "@/lib/hooks";
import { useTheme, useThemePreference, type ThemePreference } from "@/lib/theme";

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
  const { user, signOut } = useAuth();
  const router = useRouter();
  const t = useTheme();
  const { preference, setPreference } = useThemePreference();
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

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
      <Card>
        <Text style={[t.type.title, { color: t.colors.textPrimary }]}>
          {user?.display_name}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
          {user?.email}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.sm }]}>
          Reputation {user?.reputation ?? 0}
        </Text>
      </Card>

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
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: -8 },
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
});
