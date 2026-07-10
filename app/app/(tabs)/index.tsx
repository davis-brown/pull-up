import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CourtMap from "@/components/CourtMap/CourtMap";
import type { CourtPin } from "@/components/CourtMap/types";
import { GetTheAppBanner } from "@/components/GetTheAppBanner";
import { PermissionPrimer } from "@/components/PermissionPrimer";
import { locationPrimerDone, markLocationPrimerDone, onboardingSeen } from "@/lib/first-run";
import { useCourtsInBBox, type BBox } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import { useTheme } from "@/lib/theme";

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const [center, setCenter] = useState<Coords | null>(null);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [showLocationPrimer, setShowLocationPrimer] = useState(false);
  const { data: courts } = useCourtsInBBox(bbox);

  useEffect(() => {
    void (async () => {
      // On first launch the root layout redirects to onboarding; don't pop the
      // location primer (or an OS prompt) over a screen that's about to unmount.
      // The effect re-runs when the user returns to the map after onboarding.
      if (!(await onboardingSeen())) {
        setCenter(FALLBACK_CENTER);
        return;
      }
      if (Platform.OS !== "web") {
        const perms = await Location.getForegroundPermissionsAsync();
        if (!perms.granted && perms.canAskAgain && !(await locationPrimerDone())) {
          setShowLocationPrimer(true);
          return; // locate after the primer is answered
        }
      }
      setCenter((await tryGetPosition()) ?? FALLBACK_CENTER);
    })();
  }, []);

  const answerLocationPrimer = (allow: boolean) => {
    void markLocationPrimerDone();
    setShowLocationPrimer(false);
    if (allow) {
      void tryGetPosition().then((pos) => setCenter(pos ?? FALLBACK_CENTER));
    } else {
      setCenter(FALLBACK_CENTER);
    }
  };

  const pins = useMemo<CourtPin[]>(
    () =>
      (courts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        activeCount: c.active_count,
        status: c.status,
      })),
    [courts],
  );

  if (!center) {
    return (
      <View style={[styles.loading, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
        <Text style={[t.type.body, { color: t.colors.textSecondary, marginTop: t.spacing.md }]}>
          Finding courts near you…
        </Text>
        <PermissionPrimer
          visible={showLocationPrimer}
          icon="location-outline"
          title="See courts near you"
          body="pull-up uses your location to center the map on nearby courts and to verify check-ins. It's only read when you're using the app."
          allowLabel="Allow location"
          onAllow={() => answerLocationPrimer(true)}
          onDismiss={() => answerLocationPrimer(false)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GetTheAppBanner />
      <CourtMap
        courts={pins}
        initialCenter={center}
        onRegionChange={setBBox}
        onPinPress={(id) => router.push(`/court/${id}`)}
      />
      {bbox != null && courts?.length === 0 && (
        <View
          style={[
            styles.banner,
            {
              top: insets.top + 12,
              backgroundColor: t.colors.surface,
              borderColor: t.colors.border,
              borderRadius: t.radius.full,
            },
          ]}
        >
          <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
            No courts here yet — add the first one
          </Text>
        </View>
      )}
      <Pressable
        onPress={() => router.push("/court/new")}
        style={({ pressed }) => [
          styles.fab,
          {
            bottom: insets.bottom + 24,
            backgroundColor: t.colors.accent,
            borderRadius: t.radius.full,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={20} color={t.colors.onAccent} />
        <Text style={[t.type.bodyMedium, { color: t.colors.onAccent }]}>Add court</Text>
      </Pressable>
      <PermissionPrimer
        visible={showLocationPrimer}
        icon="location-outline"
        title="See courts near you"
        body="pull-up uses your location to center the map on nearby courts and to verify check-ins. It's only read when you're using the app."
        allowLabel="Allow location"
        onAllow={() => answerLocationPrimer(true)}
        onDismiss={() => answerLocationPrimer(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  fab: {
    position: "absolute",
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 18,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  banner: {
    position: "absolute",
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
});
