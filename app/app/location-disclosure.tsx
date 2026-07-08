// Prominent disclosure shown BEFORE requesting background-location
// permission, as required by Google Play's location policy (and good
// practice for Apple's "Always" review). The permission prompt only fires
// after the user accepts here.
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, ErrorText } from "@/components/ui";
import { setGeofenceMode, type GeofenceMode } from "@/lib/geofencing";
import { useTheme } from "@/lib/theme";

const points: Array<{ icon: string; text: string }> = [
  {
    icon: "location-outline",
    text: "pull-up uses your device's location in the background to detect when you arrive at or leave a basketball court.",
  },
  {
    icon: "basketball-outline",
    text: "Only court arrivals are used — a check-in at a known court is the only thing created. Your movements and location history are never recorded or stored.",
  },
  {
    icon: "battery-half-outline",
    text: "Detection uses the system's low-power region monitoring, not continuous GPS tracking.",
  },
  {
    icon: "hand-left-outline",
    text: "This is optional and off by default. You can turn it off anytime in your profile, and location detection stops immediately.",
  },
];

export default function LocationDisclosureScreen() {
  const { mode } = useLocalSearchParams<{ mode: GeofenceMode }>();
  const router = useRouter();
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target: GeofenceMode = mode === "auto" ? "auto" : "prompt";

  const accept = async () => {
    setBusy(true);
    setError(null);
    const result = await setGeofenceMode(target);
    setBusy(false);
    if (result.ok) {
      router.back();
    } else {
      setError(result.reason ?? "Could not enable auto check-in.");
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
      <Text style={[t.type.title, { color: t.colors.textPrimary }]}>
        Background location for auto check-in
      </Text>
      <Text style={[t.type.body, { color: t.colors.textSecondary, marginTop: t.spacing.sm }]}>
        {target === "auto"
          ? "Automatic mode checks you in when you arrive at a court and checks you out when you leave — without opening the app."
          : "Ask-me mode sends a notification when you arrive at a court so you can check in with one tap."}
      </Text>

      <View style={{ marginTop: t.spacing.lg, gap: t.spacing.md }}>
        {points.map((p) => (
          <View key={p.icon} style={styles.pointRow}>
            <Ionicons name={p.icon as never} size={22} color={t.colors.accent} />
            <Text style={[t.type.body, styles.pointText, { color: t.colors.textPrimary }]}>
              {p.text}
            </Text>
          </View>
        ))}
      </View>

      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.lg }]}>
        If you continue, your device will ask you to allow location access
        {"—"}including "Allow all the time" / "Always"{"—"}which this feature
        needs to work when the app is closed.
      </Text>

      <ErrorText message={error} />
      <View style={{ marginTop: t.spacing.md }}>
        <Button title="Continue" busy={busy} onPress={() => void accept()} />
        <Button title="Not now" variant="ghost" onPress={() => router.back()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pointRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  pointText: { flex: 1 },
});
