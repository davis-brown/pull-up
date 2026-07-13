import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CourtMap from "@/components/CourtMap/CourtMap";
import type { CourtPin } from "@/components/CourtMap/types";
import { FilterSheet } from "@/components/FilterSheet";
import { GetTheAppBanner } from "@/components/GetTheAppBanner";
import { MapSheet } from "@/components/MapSheet";
import { PermissionPrimer } from "@/components/PermissionPrimer";
import { SegmentedToggle } from "@/components/ui";
import type { CourtFilters } from "@/lib/court-filters";
import { courtsDisplayState, viewportTooLarge } from "@/lib/court-seeding";
import {
  locationPrimerDone,
  markLocationPrimerDone,
  onboardingSeen,
} from "@/lib/first-run";
import { expectedAt, scrubHours } from "@/lib/forecast";
import { useCourtsInBBox, useForecasts, type BBox } from "@/lib/hooks";
import { FALLBACK_CENTER, tryGetPosition, type Coords } from "@/lib/location";
import { useTheme } from "@/lib/theme";

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const [center, setCenter] = useState<Coords | null>(null);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [showLocationPrimer, setShowLocationPrimer] = useState(false);
  const [filters, setFilters] = useState<CourtFilters>({});
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "all">("now");
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(null);
  // Today's scrubbable hours, computed once per mount; hours[0] is NOW.
  const hours = useMemo(() => scrubHours(new Date()), []);
  const [scrubHour, setScrubHour] = useState(hours[0]);
  const { data } = useCourtsInBBox(bbox, filters);
  const courts = data?.courts ?? [];
  const seeding = data?.seeding ?? false;
  const tooLarge = bbox ? viewportTooLarge(bbox) : false;
  const state = courtsDisplayState({
    courtCount: courts.length,
    seeding,
    viewportTooLarge: tooLarge,
  });

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
        if (
          !perms.granted &&
          perms.canAskAgain &&
          !(await locationPrimerDone())
        ) {
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

  // One batched forecast fetch per visible id set (only in "now" mode) —
  // scrubbing below reads it locally via expectedAt, never refetching.
  const forecasts = useForecasts(mode === "now" ? courts.map((c) => c.id) : []);
  const atNow = scrubHour === hours[0];

  const pins = useMemo<CourtPin[]>(
    () =>
      courts.map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        activeCount: c.active_count,
        // "Now" mode's activity weight: the live count at the NOW position,
        // the scrubbed hour's forecast otherwise.
        expectedCount:
          mode === "now" && !atNow
            ? expectedAt(forecasts[c.id], scrubHour)
            : c.active_count,
        status: c.status,
      })),
    [courts, mode, atNow, forecasts, scrubHour],
  );

  const selectedCourt =
    mode === "now"
      ? (courts.find((c) => c.id === selectedCourtId) ?? null)
      : null;

  const activeFilterCount = Object.values(filters).filter(
    (v) => v !== undefined,
  ).length;

  if (!center) {
    return (
      <View style={[styles.loading, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
        <Text
          style={[
            t.type.body,
            { color: t.colors.textSecondary, marginTop: t.spacing.md },
          ]}
        >
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
        onPinPress={(id) => {
          if (mode === "now") {
            // Tap selects (and shows the sheet); tapping the selected pin
            // again deselects. "All courts" keeps navigate-on-tap.
            setSelectedCourtId((cur) => (cur === id ? null : id));
          } else {
            router.push(`/court/${id}`);
          }
        }}
        mode={mode}
        selectedCourtId={selectedCourtId}
      />
      <Pressable
        onPress={() => setFilterSheetOpen(true)}
        style={({ pressed }) => [
          styles.filterButton,
          t.shadows.chrome,
          {
            top: insets.top + 12,
            backgroundColor: t.colors.surface,
            borderRadius: t.radius.full,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="options" size={20} color={t.colors.textPrimary} />
        {activeFilterCount > 0 && (
          <View
            style={[
              styles.filterBadge,
              { backgroundColor: t.colors.accent, borderRadius: t.radius.full },
            ]}
          >
            <Text
              style={[
                t.type.caption,
                styles.filterBadgeText,
                { color: t.colors.onAccent },
              ]}
            >
              {activeFilterCount}
            </Text>
          </View>
        )}
      </Pressable>
      <View style={[styles.chrome, { top: insets.top + 12 }]}>
        <SegmentedToggle
          options={[
            { key: "now", label: "Now" },
            { key: "all", label: "All courts" },
          ]}
          value={mode}
          onChange={(key) => setMode(key as "now" | "all")}
        />
        {bbox != null && state !== "has-courts" && (
          <View
            style={[
              styles.banner,
              {
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
                borderRadius: t.radius.full,
              },
            ]}
          >
            {state === "seeding" && (
              <ActivityIndicator
                size="small"
                color={t.colors.accent}
                style={{ marginRight: t.spacing.xs }}
              />
            )}
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
              {state === "seeding"
                ? "Finding courts in this area…"
                : state === "zoomed-out"
                  ? "Zoom in to load courts for this area"
                  : "No courts here yet — add the first one"}
            </Text>
          </View>
        )}
      </View>
      {selectedCourt == null && (
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
          <Text style={[t.type.bodyMedium, { color: t.colors.onAccent }]}>
            Add court
          </Text>
        </Pressable>
      )}
      {selectedCourt != null && (
        <MapSheet
          court={selectedCourt}
          hours={hours}
          scrubHour={scrubHour}
          onScrub={setScrubHour}
          forecast={forecasts[selectedCourt.id]}
        />
      )}
      <PermissionPrimer
        visible={showLocationPrimer}
        icon="location-outline"
        title="See courts near you"
        body="pull-up uses your location to center the map on nearby courts and to verify check-ins. It's only read when you're using the app."
        allowLabel="Allow location"
        onAllow={() => answerLocationPrimer(true)}
        onDismiss={() => answerLocationPrimer(false)}
      />
      <FilterSheet
        visible={filterSheetOpen}
        filters={filters}
        courts={courts}
        onApply={setFilters}
        onClose={() => setFilterSheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  filterButton: {
    position: "absolute",
    right: 16,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 11,
    lineHeight: 13,
  },
  chrome: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
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
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
});
