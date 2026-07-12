import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { CourtChat } from "@/components/CourtChat";
import { CourtSessions } from "@/components/CourtSessions";
import { PermissionPrimer } from "@/components/PermissionPrimer";
import { QueryError } from "@/components/QueryError";
import { SignInAction, useSignInDetour } from "@/components/SignInCta";
import { Button, Card, ErrorText } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { markPushPrimerDone, pushPrimerDone } from "@/lib/first-run";
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
import { buildCourtLink, courtShareMessage, parseRunParam } from "@/lib/links";
import { getCurrentPosition } from "@/lib/location";
import { registerPushToken } from "@/lib/push-registration";
import { useTheme } from "@/lib/theme";

const runQualityLabel: Record<string, string> = {
  empty: "Empty",
  casual: "Casual shooting",
  good_run: "Good run",
  packed: "Packed",
};

export default function CourtDetailScreen() {
  const { id, run } = useLocalSearchParams<{ id: string; run?: string }>();
  const router = useRouter();
  const t = useTheme();
  const { user } = useAuth();
  const detour = useSignInDetour();
  const { data: court, isLoading, error: courtError, refetch } = useCourt(id);
  const { data: activity } = useCourtActivity(id);
  const { data: current } = useCurrentCheckIn();
  const checkIn = useCheckIn(id ?? "");
  const checkOut = useCheckOut();
  const vote = useVoteCourt(id ?? "");
  const { data: photoData } = useCourtPhotos(id);
  const photos = photoData?.photos;
  const externalPhotos = photoData?.external ?? [];
  const uploadPhoto = useUploadPhoto(id ?? "");
  const { data: favData } = useIsFavorite(id);
  const setFavorite = useSetFavorite(id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [showPushPrimer, setShowPushPrimer] = useState(false);

  const isFavorite = favData?.favorite ?? false;

  const toggleFavorite = () => {
    if (!user) return detour();
    const turningOn = !isFavorite;
    setFavorite.mutate(turningOn);
    if (turningOn && Platform.OS !== "web") {
      void (async () => {
        const perms = await Notifications.getPermissionsAsync();
        if (!perms.granted && perms.canAskAgain && !(await pushPrimerDone())) {
          setShowPushPrimer(true);
        }
      })();
    }
  };

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

  if (courtError && !court) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={courtError} onRetry={() => void refetch()} />
      </View>
    );
  }

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
    <>
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
              onPress={() =>
                void Share.share({
                  message: courtShareMessage(court.name, buildCourtLink(court.id)),
                }).catch(() => {})
              }
              hitSlop={10}
              style={{ marginRight: t.spacing.md }}
            >
              <Ionicons name="share-outline" size={22} color={t.colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => router.push(`/flag?entityType=court&entityId=${id}`)}
              hitSlop={10}
              style={{ marginRight: t.spacing.md }}
            >
              <Ionicons name="flag-outline" size={22} color={t.colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={toggleFavorite}
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
            {court.covered ? "  ·  Covered" : ""}
          </Text>
          {(court.access === "private" || court.access === "customers" || court.fee) && (
            <Text style={[t.type.caption, { color: t.colors.warning, marginTop: 2 }]}>
              {court.access === "private"
                ? "Private court"
                : court.access === "customers"
                  ? "Customers/members only"
                  : ""}
              {court.fee ? (court.access === "public" || !court.access ? "Fee to play" : "  ·  Fee to play") : ""}
            </Text>
          )}
          {(court.drinking_water || court.toilets || court.parking || court.fenced) && (
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
              {[
                court.drinking_water && "Water",
                court.toilets && "Restroom",
                court.parking && "Parking",
                court.fenced && "Fenced",
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </Text>
          )}
          {court.address && (
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
              {court.address}
            </Text>
          )}
          {court.opening_hours && (
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
              Hours: {court.opening_hours}
            </Text>
          )}
          {court.description && (
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: t.spacing.sm }]}>
              {court.description}
            </Text>
          )}
          {court.website && (
            <Pressable onPress={() => void Linking.openURL(court.website!)} hitSlop={6}>
              <Text style={[t.type.caption, { color: t.colors.accent, marginTop: t.spacing.sm }]}>
                Website
              </Text>
            </Pressable>
          )}
          {court.source === "osm" && (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
              Location © OpenStreetMap contributors
            </Text>
          )}
          <View style={{ marginTop: t.spacing.sm }}>
            {user ? (
              <Button
                title="Suggest an edit"
                variant="ghost"
                onPress={() => router.push(`/court/${id}/edit` as Href)}
              />
            ) : (
              <SignInAction label="Sign in to suggest an edit" />
            )}
          </View>
        </Card>

        <Card>
          <View style={styles.titleRow}>
            <Text style={[t.type.label, { color: t.colors.textSecondary }]}>Photos</Text>
            <Pressable
              onPress={() => (user ? void addPhoto() : detour())}
              hitSlop={10}
              disabled={uploadPhoto.isPending}
            >
              {uploadPhoto.isPending ? (
                <ActivityIndicator size="small" color={t.colors.accent} />
              ) : (
                <Ionicons name="camera-outline" size={22} color={t.colors.accent} />
              )}
            </Pressable>
          </View>
          {(photos?.length ?? 0) + externalPhotos.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: t.spacing.sm }}>
              {photos?.map((p) => (
                <View key={p.id} style={styles.photoWrap}>
                  <Image
                    source={{ uri: photoURL(p.storage_key) }}
                    style={[styles.photo, { borderRadius: t.radius.md }]}
                  />
                  <Pressable
                    onPress={() => router.push(`/flag?entityType=photo&entityId=${p.id}`)}
                    hitSlop={8}
                    style={[styles.photoFlag, { backgroundColor: t.colors.background + "cc" }]}
                  >
                    <Ionicons name="flag-outline" size={16} color={t.colors.textMuted} />
                  </Pressable>
                </View>
              ))}
              {externalPhotos.map((p) => (
                <Pressable key={p.id} onPress={() => void Linking.openURL(p.page_url)}>
                  <Image
                    source={{ uri: p.image_url }}
                    style={[styles.photo, { borderRadius: t.radius.md }]}
                  />
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
              No photos yet — add the first one.
            </Text>
          )}
          {externalPhotos.length > 0 && (
            <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.xs }]}>
              Some photos are from nearby on Wikimedia Commons — tap one for its
              source and license.
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
                  onPress={() => (user ? vote.mutate(1) : detour())}
                />
              </View>
              <View style={styles.voteButton}>
                <Button
                  title="Not a court"
                  variant="danger"
                  busy={vote.isPending}
                  onPress={() => (user ? vote.mutate(-1) : detour())}
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
              <Text
                style={{ fontWeight: "600" }}
                onPress={() => router.push(`/user/${ci.user_id}` as Href)}
              >
                {ci.display_name}
              </Text>
              {"  ·  since "}
              {new Date(ci.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          ))}

          <ErrorText message={error} />
          <View style={{ marginTop: t.spacing.sm }}>
            {!user ? (
              <SignInAction label="Sign in to check in" />
            ) : checkedInHere ? (
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

        <CourtSessions
          courtId={id ?? ""}
          courtName={court.name}
          highlightId={parseRunParam(run)}
        />

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
                <View style={styles.titleRow}>
                  <Text style={[t.type.bodyMedium, styles.titleText, { color: t.colors.textPrimary }]}>
                    {r.run_quality ? runQualityLabel[r.run_quality] : "Report"}
                    {r.player_count != null ? `  ·  ~${r.player_count} playing` : ""}
                  </Text>
                  <Pressable
                    onPress={() => router.push(`/flag?entityType=report&entityId=${r.id}`)}
                    hitSlop={10}
                  >
                    <Ionicons name="flag-outline" size={16} color={t.colors.textMuted} />
                  </Pressable>
                </View>
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

        <CourtChat courtId={id ?? ""} />
      </ScrollView>
      <PermissionPrimer
        visible={showPushPrimer}
        icon="notifications-outline"
        title="Hear when a run is planned"
        body="Get a notification when someone plans a run at a court you favorited. You can turn this off anytime in system settings."
        allowLabel="Turn on notifications"
        onAllow={() => {
          void markPushPrimerDone();
          setShowPushPrimer(false);
          void registerPushToken({ requestPermission: true });
        }}
        onDismiss={() => {
          void markPushPrimerDone();
          setShowPushPrimer(false);
        }}
      />
    </>
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
  photo: { width: 160, height: 120 },
  photoWrap: { marginRight: 10 },
  photoFlag: {
    position: "absolute",
    top: 6,
    right: 6,
    padding: 4,
    borderRadius: 12,
  },
  voteRow: { flexDirection: "row", gap: 10 },
  voteButton: { flex: 1 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  liveDot: { width: 9, height: 9, borderRadius: 5 },
  reportRow: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
