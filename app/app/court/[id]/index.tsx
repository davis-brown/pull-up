import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { Stack, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
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
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CourtMap from "@/components/CourtMap/CourtMap";
import type { CourtPin } from "@/components/CourtMap/types";
import { CourtChat } from "@/components/CourtChat";
import { CourtSessions } from "@/components/CourtSessions";
import { CourtConditions } from "@/components/court/CourtConditions";
import { FactsGrid } from "@/components/court/FactsGrid";
import { LiveBar } from "@/components/court/LiveBar";
import { PopularTimes } from "@/components/court/PopularTimes";
import { PermissionPrimer } from "@/components/PermissionPrimer";
import { QueryError } from "@/components/QueryError";
import { SignInAction, useSignInDetour } from "@/components/SignInCta";
import { Button, Card, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { markPushPrimerDone, pushPrimerDone } from "@/lib/first-run";
import {
  photoURL,
  useCourt,
  useCourtActivity,
  useCourtPhotos,
  useForecasts,
  useIsFavorite,
  useSetFavorite,
  useUploadPhoto,
  useVoteCourt,
} from "@/lib/hooks";
import { buildCourtLink, courtShareMessage, parseRunParam } from "@/lib/links";
import { registerPushToken } from "@/lib/push-registration";
import { parseRouteId, safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { CourtDetail } from "@/lib/types";

const runQualityLabel: Record<string, string> = {
  empty: "Empty",
  casual: "Casual shooting",
  good_run: "Good run",
  packed: "Packed",
};

// Trivially-parseable close time for the subline. Only a plain single range
// like "09:00-22:00" is understood — anything richer (OSM syntax, "24/7",
// weekday rules) returns null and the raw string is shown elsewhere. This is
// deliberately not an opening_hours parser.
function closeLabel(openingHours: string | null): string | null {
  if (!openingHours) return null;
  const m = openingHours.trim().match(/^\d{1,2}:\d{2}\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  if (h > 24) return null;
  const period = h < 12 || h === 24 ? "AM" : "PM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return min === "00" ? `${disp} ${period}` : `${disp}:${min} ${period}`;
}

export default function CourtDetailScreen() {
  const params = useLocalSearchParams();
  const id = parseRouteId(params.id);
  const run = params.run;
  const router = useRouter();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const detour = useSignInDetour();
  const { data: court, isLoading, error: courtError, refetch } = useCourt(id);
  const { data: activity, error: activityError } = useCourtActivity(id);
  const vote = useVoteCourt(id ?? "");
  const { data: photoData, error: photoQueryError } = useCourtPhotos(id);
  const photos = photoData?.photos;
  const externalPhotos = photoData?.external ?? [];
  const uploadPhoto = useUploadPhoto(id ?? "");
  const { data: favData, error: favoriteError } = useIsFavorite(id);
  const setFavorite = useSetFavorite(id ?? "");
  const forecasts = useForecasts(id ? [id] : []);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [showPushPrimer, setShowPushPrimer] = useState(false);

  // On desktop web the standalone detail screen doesn't exist — the map home's
  // side panel is the detail surface. Redirect so a deep link / refresh lands
  // in the panel. Web + wide only, so mobile web and native are untouched; the
  // target ("/") never navigates back here on desktop, so there's no loop.
  const { width } = useWindowDimensions();
  const isDesktopWeb = Platform.OS === "web" && width >= 1024;
  useEffect(() => {
    if (isDesktopWeb && id) {
      router.replace(`/?court=${safePathSegment(id)}`);
    }
  }, [isDesktopWeb, id, router]);

  if (!id) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError
          error={new Error("Invalid court id")}
          title="Invalid court link"
          message="This court link is not valid."
        />
      </View>
    );
  }

  const isFavorite = favData?.favorite ?? false;

  const toggleFavorite = () => {
    if (!user) return detour();
    const turningOn = !isFavorite;
    setFavorite.mutate(turningOn, { onError: (e) => setError(e.message) });
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

  // Redirecting to the desktop panel — render nothing to avoid a flash of the
  // mobile detail layout.
  if (isDesktopWeb) return null;

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

  const detail: CourtDetail = court;
  const activeCount = activity?.active_count ?? detail.active_count;
  const forecast = forecasts[detail.id];

  const openDirections = () => {
    const label = encodeURIComponent(detail.name);
    const url =
      Platform.select({
        ios: `maps://?daddr=${detail.lat},${detail.lng}&q=${label}`,
        android: `geo:${detail.lat},${detail.lng}?q=${detail.lat},${detail.lng}(${label})`,
        default: `https://www.google.com/maps/dir/?api=1&destination=${detail.lat},${detail.lng}`,
      }) ?? `https://www.google.com/maps/dir/?api=1&destination=${detail.lat},${detail.lng}`;
    void Linking.openURL(url).catch(() => {});
  };

  const close = closeLabel(detail.opening_hours);
  const subline = [detail.address, close ? `open til ${close}` : null]
    .filter(Boolean)
    .join("  ·  ");

  const mapPin: CourtPin = {
    id: detail.id,
    name: detail.name,
    lat: detail.lat,
    lng: detail.lng,
    activeCount,
    expectedCount: activeCount,
    status: detail.status,
  };

  const accessWarning =
    detail.access === "private"
      ? "Private court"
      : detail.access === "customers"
        ? "Customers/members only"
        : "";
  const amenities = [
    detail.drinking_water && "Water",
    detail.toilets && "Restroom",
    detail.parking && "Parking",
    detail.fenced && "Fenced",
    detail.covered && "Covered",
  ].filter(Boolean);
  const hasPhotos = (photos?.length ?? 0) + externalPhotos.length > 0;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.screen, { backgroundColor: t.colors.background }]}>
        <ScrollView
          style={{ backgroundColor: t.colors.background }}
          contentContainerStyle={{ paddingBottom: 140 }}
        >
          {/* Map header — the court pinned and selected, interactions off. */}
          <View style={styles.mapHeader} pointerEvents="none">
            <CourtMap
              courts={[mapPin]}
              initialCenter={{ lat: detail.lat, lng: detail.lng }}
              initialZoom={15}
              showUserLocation={false}
              mode="now"
              selectedCourtId={detail.id}
            />
          </View>

          {/* Content sheet overlapping the map by 20px. */}
          <View
            style={[
              styles.sheet,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={styles.titleRow}>
              <Text style={[t.type.display, styles.titleText, { color: t.colors.textPrimary }]}>
                {detail.name}
              </Text>
              <View style={styles.titleActions}>
                <Pressable
                  onPress={() => {
                    const url = buildCourtLink(detail.id);
                    void Share.share({
                      message: courtShareMessage(detail.name, url),
                      url,
                    }).catch(() => {});
                  }}
                  hitSlop={10}
                >
                  <Ionicons name="share-outline" size={22} color={t.colors.textMuted} />
                </Pressable>
                <Pressable
                    onPress={() => router.push(`/flag?entityType=court&entityId=${safePathSegment(id)}`)}
                  hitSlop={10}
                >
                  <Ionicons name="flag-outline" size={22} color={t.colors.textMuted} />
                </Pressable>
                <Pressable onPress={toggleFavorite} hitSlop={10} disabled={setFavorite.isPending}>
                  <Ionicons
                    name={isFavorite ? "heart" : "heart-outline"}
                    size={26}
                    color={isFavorite ? t.colors.accent : t.colors.textMuted}
                  />
                </Pressable>
              </View>
            </View>

            {subline ? (
              <Text
                style={[t.type.caption, styles.gap, { color: t.colors.textSecondary }]}
              >
                {subline}
              </Text>
            ) : null}

            {(accessWarning || detail.fee) && (
              <Text style={[t.type.caption, styles.gap, { color: t.colors.warning }]}>
                {accessWarning}
                {detail.fee ? (accessWarning ? "  ·  Fee to play" : "Fee to play") : ""}
              </Text>
            )}

            {amenities.length > 0 && (
              <Text style={[t.type.caption, styles.gap, { color: t.colors.textSecondary }]}>
                {amenities.join("  ·  ")}
              </Text>
            )}

            <View style={styles.section}>
              <FactsGrid court={detail} />
            </View>

            <View style={styles.section}>
              <Overline style={{ marginBottom: t.spacing.sm }}>Conditions</Overline>
              <CourtConditions court={detail} />
            </View>

            {hasPhotos && (
              <View style={styles.section}>
                <View style={styles.rowBetween}>
                  <Overline>Photos</Overline>
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
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: t.spacing.sm }}
                >
                  {photos?.map((p) => (
                    <View key={p.id} style={styles.photoWrap}>
                      <Image
                        source={{ uri: photoURL(p.storage_key) }}
                        style={styles.photo}
                      />
                      <Pressable
                        onPress={() => router.push(`/flag?entityType=photo&entityId=${safePathSegment(p.id)}`)}
                        hitSlop={8}
                        style={[styles.photoFlag, { backgroundColor: t.colors.background + "cc" }]}
                      >
                        <Ionicons name="flag-outline" size={16} color={t.colors.textMuted} />
                      </Pressable>
                    </View>
                  ))}
                  {externalPhotos.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => void Linking.openURL(p.page_url)}
                      style={styles.photoWrap}
                    >
                      <Image source={{ uri: p.image_url }} style={styles.photo} />
                    </Pressable>
                  ))}
                </ScrollView>
                {externalPhotos.length > 0 && (
                  <Text style={[t.type.caption, styles.gap, { color: t.colors.textMuted }]}>
                    Some photos are from nearby on Wikimedia Commons — tap one for its source
                    and license.
                  </Text>
                )}
                <ErrorText message={photoError ?? photoQueryError?.message ?? null} />
              </View>
            )}

            {!hasPhotos && (
              <View style={styles.section}>
                <View style={styles.rowBetween}>
                  <Overline>Photos</Overline>
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
                {photoQueryError ? null : (
                  <Text style={[t.type.caption, styles.gap, { color: t.colors.textMuted }]}>
                    No photos yet — add the first one.
                  </Text>
                )}
                <ErrorText message={photoError ?? photoQueryError?.message ?? null} />
              </View>
            )}

            <View style={[styles.divided, { borderTopColor: t.colors.border }]}>
              <PopularTimes forecast={forecast} />
            </View>

            {/* Directions row between dividers. */}
            <Pressable
              onPress={openDirections}
              style={[
                styles.linkRow,
                { borderTopColor: t.colors.border, borderBottomColor: t.colors.border },
              ]}
            >
              <Ionicons name="navigate-outline" size={20} color={t.colors.accent} />
              <Text style={[t.type.bodyMedium, styles.linkLabel, { color: t.colors.textPrimary }]}>
                Directions
              </Text>
              <Ionicons name="chevron-forward" size={18} color={t.colors.textMuted} />
            </Pressable>

            {detail.description ? (
              <Text style={[t.type.body, styles.section, { color: t.colors.textSecondary }]}>
                {detail.description}
              </Text>
            ) : null}

            {detail.opening_hours && !close ? (
              <Text style={[t.type.caption, styles.gap, { color: t.colors.textSecondary }]}>
                Hours: {detail.opening_hours}
              </Text>
            ) : null}

            {detail.website ? (
              <Pressable onPress={() => void Linking.openURL(detail.website!)} hitSlop={6}>
                <Text style={[t.type.caption, styles.gap, { color: t.colors.accent }]}>
                  Website
                </Text>
              </Pressable>
            ) : null}

            {detail.source === "osm" ? (
              <Text style={[t.type.caption, styles.gap, { color: t.colors.textMuted }]}>
                Location © OpenStreetMap contributors
              </Text>
            ) : null}

            <View style={styles.section}>
              {user ? (
                <Button
                  title="Suggest an edit"
                  variant="ghost"
                  onPress={() => router.push(`/court/${safePathSegment(id)}/edit` as Href)}
                />
              ) : (
                <SignInAction label="Sign in to suggest an edit" />
              )}
            </View>

            {detail.status === "pending" && (
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
                      onPress={() => (user
                        ? vote.mutate(1, { onError: (e) => setError(e.message) })
                        : detour())}
                    />
                  </View>
                  <View style={styles.voteButton}>
                    <Button
                      title="Not a court"
                      variant="danger"
                      busy={vote.isPending}
                      onPress={() => (user
                        ? vote.mutate(-1, { onError: (e) => setError(e.message) })
                        : detour())}
                    />
                  </View>
                </View>
              </Card>
            )}

            {(activity?.check_ins?.length ?? 0) > 0 && (
              <View style={[styles.divided, { borderTopColor: t.colors.border }]}>
                <Overline>Checked in now</Overline>
                {activity!.check_ins.map((ci) => (
                  <Text
                    key={ci.id}
                    style={[t.type.caption, { color: t.colors.textSecondary, paddingVertical: 3 }]}
                  >
                    <Text
                      style={{ fontFamily: t.fonts.bodySemi }}
                      onPress={() => router.push(`/user/${safePathSegment(ci.user_id)}` as Href)}
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
              </View>
            )}

            <ErrorText message={error ?? favoriteError?.message ?? activityError?.message ?? null} />

            <View style={styles.section}>
              <Button
                title="Report the crowd"
                variant="ghost"
                onPress={() => router.push(`/court/${safePathSegment(id)}/report`)}
              />
            </View>

            <CourtSessions
              courtId={id ?? ""}
              courtName={detail.name}
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
                    <View style={styles.rowBetween}>
                      <Text
                        style={[t.type.bodyMedium, styles.titleText, { color: t.colors.textPrimary }]}
                      >
                        {r.run_quality ? runQualityLabel[r.run_quality] : "Report"}
                        {r.player_count != null ? `  ·  ~${r.player_count} playing` : ""}
                      </Text>
                      <Pressable
                        onPress={() => router.push(`/flag?entityType=report&entityId=${safePathSegment(r.id)}`)}
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
          </View>
        </ScrollView>

        {/* Circular back button over the map, under the safe area. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={[
            styles.backButton,
            t.shadows.chrome,
            { top: insets.top + 8, backgroundColor: t.colors.surface },
          ]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={22} color={t.colors.textPrimary} />
        </Pressable>

        {/* Sticky live/check-in bar. */}
        <LiveBar
          liveCount={activeCount}
          onCheckIn={() => router.push(`/check-in?courtId=${safePathSegment(id)}`)}
        />
      </View>

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
  screen: { flex: 1 },
  mapHeader: { height: 190 },
  sheet: {
    marginTop: -20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  titleActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingTop: 4,
  },
  titleText: { flex: 1 },
  gap: { marginTop: 6 },
  section: { marginTop: 20 },
  divided: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 20,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkLabel: { flex: 1 },
  photo: { width: 150, height: 110, borderRadius: 16 },
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
  reportRow: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  backButton: {
    position: "absolute",
    left: 16,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
});
