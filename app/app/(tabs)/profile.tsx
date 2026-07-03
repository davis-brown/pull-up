import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCheckOut, useCurrentCheckIn } from "@/lib/hooks";

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { data } = useCurrentCheckIn();
  const checkOut = useCheckOut();
  const checkIn = data?.check_in ?? null;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.display_name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.reputation}>Reputation: {user?.reputation ?? 0}</Text>
      </View>

      {checkIn && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>You're checked in</Text>
          <Text style={styles.checkInCourt}>{checkIn.court_name ?? "a court"}</Text>
          <Text style={styles.meta}>
            Auto-expires at{" "}
            {new Date(checkIn.expires_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Button
            title="Check out — I left"
            variant="secondary"
            busy={checkOut.isPending}
            onPress={() =>
              checkOut.mutate(undefined, {
                onSuccess: () => router.push(`/court/${checkIn.court_id}`),
              })
            }
          />
        </View>
      )}

      <Button title="Sign out" variant="danger" onPress={() => void signOut()} />

      <Text style={styles.attribution}>
        Court data © OpenStreetMap contributors (ODbL) and pull-up users.{"\n"}
        Maps © Mapbox.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#eee",
  },
  name: { fontSize: 22, fontWeight: "800" },
  email: { color: "#777", marginTop: 2 },
  reputation: { marginTop: 8, color: "#444" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#1a7f1a", textTransform: "uppercase" },
  checkInCourt: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  meta: { color: "#777", marginTop: 2, marginBottom: 8 },
  attribution: { color: "#999", fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 18 },
});
