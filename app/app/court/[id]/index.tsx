import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, ErrorText } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  useCheckIn,
  useCheckOut,
  useCourt,
  useCourtActivity,
  useCurrentCheckIn,
  useVoteCourt,
} from "@/lib/hooks";
import { getCurrentPosition } from "@/lib/location";

const runQualityLabel: Record<string, string> = {
  empty: "Empty",
  casual: "Casual shooting",
  good_run: "Good run 🔥",
  packed: "Packed",
};

export default function CourtDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: court, isLoading } = useCourt(id);
  const { data: activity } = useCourtActivity(id);
  const { data: current } = useCurrentCheckIn();
  const checkIn = useCheckIn(id ?? "");
  const checkOut = useCheckOut();
  const vote = useVoteCourt(id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const checkedInHere = current?.check_in?.court_id === id;

  const doCheckIn = async () => {
    setError(null);
    setLocating(true);
    try {
      const coords = await getCurrentPosition();
      checkIn.mutate(coords, {
        onError: (e) => {
          if (e instanceof ApiError && e.status === 422) {
            const meters = Math.round(Number(e.body.distance_m ?? 0));
            setError(
              `You need to be at the court to check in — you're about ${meters} m away.`,
            );
          } else {
            setError(e.message);
          }
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get your location");
    } finally {
      setLocating(false);
    }
  };

  if (isLoading || !court) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const live = (activity?.active_count ?? court.active_count) > 0;

  return (
    <AuthGate>
      <Stack.Screen options={{ title: court.name }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.name}>{court.name}</Text>
          <Text style={styles.meta}>
            {court.indoor ? "Indoor" : "Outdoor"}
            {court.hoop_count ? ` · ${court.hoop_count} hoops` : ""}
            {court.surface ? ` · ${court.surface}` : ""}
            {court.lighting ? " · lit at night" : ""}
          </Text>
          {court.address && <Text style={styles.meta}>{court.address}</Text>}
          {court.source === "osm" && (
            <Text style={styles.osmNote}>Court location © OpenStreetMap contributors</Text>
          )}
        </View>

        {court.status === "pending" && (
          <View style={[styles.card, styles.pendingCard]}>
            <Text style={styles.pendingTitle}>Unverified court</Text>
            <Text style={styles.meta}>
              Someone reported this court but it hasn't been confirmed. Is it real?
            </Text>
            <View style={styles.voteRow}>
              <View style={styles.voteButton}>
                <Button
                  title="✓ It's real"
                  variant="secondary"
                  busy={vote.isPending}
                  onPress={() => vote.mutate(1)}
                />
              </View>
              <View style={styles.voteButton}>
                <Button
                  title="✗ Not a court"
                  variant="secondary"
                  busy={vote.isPending}
                  onPress={() => vote.mutate(-1)}
                />
              </View>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <Text style={[styles.liveHeader, live ? styles.liveText : styles.quietText]}>
            {live
              ? `🏀 ${activity?.active_count ?? court.active_count} checked in right now`
              : "Quiet — no one checked in"}
          </Text>
          {activity?.check_ins.map((ci) => (
            <Text key={ci.id} style={styles.playerRow}>
              {ci.display_name} · since{" "}
              {new Date(ci.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          ))}

          <ErrorText message={error} />
          {checkedInHere ? (
            <Button
              title="Check out — I left"
              variant="secondary"
              busy={checkOut.isPending}
              onPress={() => checkOut.mutate()}
            />
          ) : (
            <Button
              title="I'm here — check in"
              busy={locating || checkIn.isPending}
              onPress={() => void doCheckIn()}
            />
          )}
          <Button
            title="Report the crowd"
            variant="secondary"
            onPress={() => router.push(`/court/${id}/report`)}
          />
        </View>

        {activity && activity.reports.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Recent reports</Text>
            {activity.reports.map((r) => (
              <View key={r.id} style={styles.reportRow}>
                <Text style={styles.reportText}>
                  {r.run_quality ? runQualityLabel[r.run_quality] : ""}
                  {r.player_count != null ? ` · ~${r.player_count} playing` : ""}
                </Text>
                {r.note ? <Text style={styles.reportNote}>“{r.note}”</Text> : null}
                <Text style={styles.reportMeta}>
                  {r.display_name} ·{" "}
                  {new Date(r.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { padding: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#eee",
  },
  pendingCard: { borderColor: "#f0c000", backgroundColor: "#fffaeb" },
  pendingTitle: { fontWeight: "800", color: "#9a7b00", marginBottom: 4 },
  voteRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  voteButton: { flex: 1 },
  name: { fontSize: 24, fontWeight: "800" },
  meta: { color: "#666", marginTop: 4 },
  osmNote: { color: "#999", fontSize: 11, marginTop: 8 },
  liveHeader: { fontSize: 17, fontWeight: "700", marginBottom: 8 },
  liveText: { color: "#1a7f1a" },
  quietText: { color: "#888" },
  playerRow: { color: "#444", paddingVertical: 2 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#777", textTransform: "uppercase", marginBottom: 8 },
  reportRow: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f2f2f2" },
  reportText: { fontWeight: "600", color: "#333" },
  reportNote: { color: "#555", fontStyle: "italic", marginTop: 2 },
  reportMeta: { color: "#999", fontSize: 12, marginTop: 2 },
});
