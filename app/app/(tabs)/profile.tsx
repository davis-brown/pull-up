import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Chip, ErrorText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  geofencingSupported,
  getGeofenceMode,
  setGeofenceMode,
  type GeofenceMode,
} from "@/lib/geofencing";
import { useCheckOut, useCurrentCheckIn } from "@/lib/hooks";
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

  useEffect(() => {
    void getGeofenceMode().then(setGeoMode);
  }, []);

  const changeGeoMode = async (mode: GeofenceMode) => {
    setGeoError(null);
    const result = await setGeofenceMode(mode);
    if (result.ok) {
      setGeoMode(mode);
    } else {
      setGeoError(result.reason ?? "Could not enable auto check-in.");
    }
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

      <Button title="Sign out" variant="danger" onPress={() => void signOut()} />

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
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  attribution: { textAlign: "center", lineHeight: 18 },
});
