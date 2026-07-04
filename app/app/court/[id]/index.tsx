import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Card, ErrorText } from "@/components/ui";
import { ApiError } from "@/lib/api";
import {
  photoURL,
  useCheckIn,
  useCheckOut,
  useCourt,
  useCourtActivity,
  useCourtPhotos,
  useCurrentCheckIn,
  useIsFavorite,
  useSetFavorite,
  useUploadPhoto,
  useVoteCourt,
} from "@/lib/hooks";
import { getCurrentPosition } from "@/lib/location";
import { useTheme } from "@/lib/theme";

const runQualityLabel: Record<string, string> = {
  empty: "Empty",
  casual: "Casual shooting",
  good_run: "Good run",
  packed: "Packed",
};

export default function CourtDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const { data: court, isLoading } = useCourt(id);
  const { data: activity } = useCourtActivity(id);
  const { data: current } = useCurrentCheckIn();
  const checkIn = useCheckIn(id ?? "");
  const checkOut = useCheckOut();
  const vote = useVoteCourt(id ?? "");
  const { data: photos } = useCourtPhotos(id);
  const uploadPhoto = useUploadPhoto(id ?? "");
  const { data: favData } = useIsFavorite(id);
  const setFavorite = useSetFavorite(id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const isFavorite = favData?.favorite ?? false;

  const addPhoto = async () => {
    setPhotoError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    uploadPhoto.mutate(
      { uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" },
      { onError: (e) => setPhotoError(e.message) },
    );
  };

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
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
      </View>
    );
  }

  const activeCount = activity?.active_count ?? court.active_count;
  const live = activeCount > 0;

  return (
    <AuthGate>
      <Stack.Screen options={{ title: court.name }} />
      <ScrollView
        style={{ backgroundColor: t.colors.background }}
        contentContainerStyle={{ padding: t.spacing.lg }}
      >
        <Card>
          <View style={styles.titleRow}>
            <Text style={[t.type.title, styles.titleText, { color: t.colors.textPrimary }]}>
              {court.name}
            </Text>
            <Pressable
              onPress={() => setFavorite.mutate(!isFavorite)}
              hitSlop={10}
              disabled={setFavorite.isPending}
            >
              <Ionicons
                name={isFavorite ? "heart" : "heart-outline"}
                size={26}
                color={isFavorite ? t.colors.accent : t.colors.textMuted}
              />
            </Pressable>
          </View>
          <Text
            style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.xs }]}
          >
            {court.indoor ? "Indoor" : "Outdoor"}
            {court.hoop_count ? `  ·  ${court.hoop_count} hoops` : ""}
            {court.surface ? `  ·  ${court.surface}` : ""}
            {court.lighting ? "  ·  Lit at night" : ""}
          </Text>
          {court.address && (
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
              {court.address}
            </Text>
          )}
          {court.source === "osm" && (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
              Location © OpenStreetMap contributors
            </Text>
          )}
        </Card>

        <Card>
          <View style={styles.titleRow}>
            <Text style={[t.type.label, { color: t.colors.textSecondary }]}>Photos</Text>
            <Pressable onPress={() => void addPhoto()} hitSlop={10} disabled={uploadPhoto.isPending}>
              {uploadPhoto.isPending ? (
                <ActivityIndicator size="small" color={t.colors.accent} />
              ) : (
                <Ionicons name="camera-outline" size={22} color={t.colors.accent} />
              )}
            </Pressable>
          </View>
          {(photos?.length ?? 0) > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: t.spacing.sm }}>
              {photos!.map((p) => (
                <Image
                  key={p.id}
                  source={{ uri: photoURL(p.storage_key) }}
                  style={[styles.photo, { borderRadius: t.radius.md }]}
                />
              ))}
            </ScrollView>
          ) : (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
              No photos yet — add the first one.
            </Text>
          )}
          <ErrorText message={photoError} />
        </Card>

        {court.status === "pending" && (
          <Card tone="warning">
            <Text style={[t.type.label, { color: t.colors.warning }]}>Unverified court</Text>
            <Text
              style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.xs }]}
            >
              Someone reported this court but it hasn't been confirmed yet. Is it real?
            </Text>
            <View style={[styles.voteRow, { marginTop: t.spacing.sm }]}>
              <View style={styles.voteButton}>
                <Button
                  title="It's real"
                  variant="secondary"
                  busy={vote.isPending}
                  onPress={() => vote.mutate(1)}
                />
              </View>
              <View style={styles.voteButton}>
                <Button
                  title="Not a court"
                  variant="danger"
                  busy={vote.isPending}
                  onPress={() => vote.mutate(-1)}
                />
              </View>
            </View>
          </Card>
        )}

        <Card>
          <View style={styles.liveRow}>
            <View
              style={[
                styles.liveDot,
                { backgroundColor: live ? t.colors.live : t.colors.textMuted },
              ]}
            />
            <Text
              style={[
                t.type.heading,
                { color: live ? t.colors.live : t.colors.textSecondary },
              ]}
            >
              {live
                ? `${activeCount} checked in right now`
                : "Quiet — no one checked in"}
            </Text>
          </View>
          {activity?.check_ins?.map((ci) => (
            <Text
              key={ci.id}
              style={[t.type.caption, { color: t.colors.textSecondary, paddingVertical: 2 }]}
            >
              {ci.display_name}  ·  since{" "}
              {new Date(ci.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          ))}

          <ErrorText message={error} />
          <View style={{ marginTop: t.spacing.sm }}>
            {checkedInHere ? (
              <Button
                title="Check out"
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
              variant="ghost"
              onPress={() => router.push(`/court/${id}/report`)}
            />
          </View>
        </Card>

        {(activity?.reports?.length ?? 0) > 0 && (
          <Card>
            <Text style={[t.type.label, { color: t.colors.textSecondary }]}>
              Recent reports
            </Text>
            {activity!.reports.map((r) => (
              <View
                key={r.id}
                style={[
                  styles.reportRow,
                  { borderTopColor: t.colors.border, marginTop: t.spacing.sm },
                ]}
              >
                <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
                  {r.run_quality ? runQualityLabel[r.run_quality] : "Report"}
                  {r.player_count != null ? `  ·  ~${r.player_count} playing` : ""}
                </Text>
                {r.note ? (
                  <Text
                    style={[
                      t.type.caption,
                      { color: t.colors.textSecondary, fontStyle: "italic", marginTop: 2 },
                    ]}
                  >
                    “{r.note}”
                  </Text>
                ) : null}
                <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 2 }]}>
                  {r.display_name}  ·{" "}
                  {new Date(r.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  titleText: { flex: 1 },
  photo: { width: 160, height: 120, marginRight: 10 },
  voteRow: { flexDirection: "row", gap: 10 },
  voteButton: { flex: 1 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  reportRow: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
