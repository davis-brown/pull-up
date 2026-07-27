import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import CourtMap from "@/components/CourtMap/CourtMap";
import type { CameraTarget, CourtPin } from "@/components/CourtMap/types";
import { DesktopPanel } from "@/components/DesktopPanel";
import {
  DiscoverySearchButton,
  DiscoverySearchSheet,
} from "@/components/DiscoverySearch";
import { FilterSheet } from "@/components/FilterSheet";
import { GetTheAppBanner } from "@/components/GetTheAppBanner";
import { MapSheet } from "@/components/MapSheet";
import { PermissionPrimer } from "@/components/PermissionPrimer";
import { SegmentedToggle, withAlpha } from "@/components/ui";
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
import { parseRouteId, safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { AreaSearchHit, CourtSearchHit } from "@/lib/types";

export default function MapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const { width } = useWindowDimensions();
  // Desktop master-detail (Task 14) is web-only and gated on a wide viewport;
  // below this, and on native, the mobile layout is used unchanged.
  const isDesktop = Platform.OS === "web" && width >= 1024;
  // Deep link: /court/[id] redirects to /?court=<id> on desktop web, and the
  // panel opens straight to that court's detail.
  const params = useLocalSearchParams();
  const courtParam = parseRouteId(params.court);
  const [center, setCenter] = useState<Coords | null>(null);
  const [bbox, setBBox] = useState<BBox | null>(null);
  const [showLocationPrimer, setShowLocationPrimer] = useState(false);
  const [filters, setFilters] = useState<CourtFilters>({});
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [mode, setMode] = useState<"now" | "all">("now");
  const [selectedCourtId, setSelectedCourtId] = useState<string | null>(
    courtParam ?? null,
  );
  const [hoveredCourtId, setHoveredCourtId] = useState<string | null>(null);
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

  // Keep the panel in sync if the deep-link param arrives after mount (e.g. a
  // /court/[id] redirect while the map is already open). Depending only on the
  // param means tapping "back" (which clears the selection) never re-triggers.
  useEffect(() => {
    if (isDesktop && courtParam) {
      setSelectedCourtId(courtParam);
    }
  }, [courtParam, isDesktop]);

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
  // scrubbing below reads it locally via expectedAt, never refetching. The
  // selected court is passed as priorityId so it's never dropped by the
  // 50-id cap even when the viewport has more courts than that.
  const forecasts = useForecasts(
    mode === "now" ? courts.map((c) => c.id) : [],
    mode === "now" ? selectedCourtId : null,
  );
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
        nextRunAt: c.next_run_at,
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

  // Desktop status chip: total loaded courts and how many are live now.
  const totalCourts = courts.length;
  const activeCourts = courts.filter((c) => c.active_count > 0).length;
  const searchBias = bbox
    ? {
        lat: (bbox.minLat + bbox.maxLat) / 2,
        lng: (bbox.minLng + bbox.maxLng) / 2,
      }
    : (center ?? FALLBACK_CENTER);

  const selectSearchCourt = (court: CourtSearchHit) => {
    setSearchOpen(false);
    if (isDesktop) {
      setSelectedCourtId(court.id);
      setCameraTarget({
        key: Date.now(),
        kind: "center",
        center: { lat: court.lat, lng: court.lng },
        zoom: 15,
      });
    } else {
      router.push(`/court/${safePathSegment(court.id)}`);
    }
  };

  const selectSearchArea = (area: AreaSearchHit) => {
    setSearchOpen(false);
    setSelectedCourtId(null);
    setCameraTarget({
      key: Date.now(),
      kind: "bounds",
      bbox: {
        minLng: area.bbox[0],
        minLat: area.bbox[1],
        maxLng: area.bbox[2],
        maxLat: area.bbox[3],
      },
    });
  };

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

  if (isDesktop) {
    return (
      <View style={styles.desktopRow}>
        <DesktopPanel
          courts={courts}
          selectedId={selectedCourtId}
          onSelect={setSelectedCourtId}
          onHover={setHoveredCourtId}
        />
        <View style={styles.mapPane}>
          <CourtMap
            courts={pins}
            initialCenter={center}
            cameraTarget={cameraTarget}
            onRegionChange={setBBox}
            // Desktop: a pin click selects into the panel (no navigation);
            // clicking the selected pin again clears back to the list.
            onPinPress={(id) =>
              setSelectedCourtId((cur) => (cur === id ? null : id))
            }
            mode={mode}
            selectedCourtId={selectedCourtId}
            hoveredCourtId={hoveredCourtId}
          />
          <Pressable
            onPress={() => setFilterSheetOpen(true)}
            style={({ pressed }) => [
              styles.filterButton,
              styles.filterButtonFloating,
              t.shadows.chrome,
              {
                top: 12,
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
          <View style={[styles.chromeCentered, { top: 12 }]}>
            <SegmentedToggle
              options={[
                { key: "now", label: "Now" },
                { key: "all", label: "All courts" },
              ]}
              value={mode}
              onChange={(key) => setMode(key as "now" | "all")}
            />
          </View>
          <View style={[styles.chromeCentered, { top: 66 }]}>
            <DiscoverySearchButton onPress={() => setSearchOpen(true)} />
          </View>
          <View
            style={[
              styles.statusChip,
              t.shadows.chrome,
              {
                bottom: 24,
                backgroundColor: withAlpha(t.colors.surface, 0.94),
                borderRadius: 14,
              },
            ]}
          >
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
              {totalCourts} courts
              {" · "}
              <Text style={{ color: t.colors.live, fontFamily: t.fonts.bodySemi }}>
                {activeCourts} active now
              </Text>
            </Text>
          </View>
          <FilterSheet
            visible={filterSheetOpen}
            filters={filters}
            courts={courts}
            onApply={setFilters}
            onClose={() => setFilterSheetOpen(false)}
          />
          <DiscoverySearchSheet
            visible={searchOpen}
            bias={searchBias}
            onCourt={selectSearchCourt}
            onArea={selectSearchArea}
            onClose={() => setSearchOpen(false)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GetTheAppBanner />
      {/* Overlays anchor to this map area, not the screen container — on
          mobile web the get-the-app banner above occupies the top of the
          container in normal flow, and container-anchored chrome would
          render on top of it (insets.top is 0 in a browser). */}
      <View style={styles.mapArea}>
      <CourtMap
        courts={pins}
        initialCenter={center}
        cameraTarget={cameraTarget}
        onRegionChange={setBBox}
        onPinPress={(id) => {
          if (mode === "now") {
            // Tap selects (and shows the sheet); tapping the selected pin
            // again deselects. "All courts" keeps navigate-on-tap.
            setSelectedCourtId((cur) => (cur === id ? null : id));
          } else {
            router.push(`/court/${safePathSegment(id)}`);
          }
        }}
        mode={mode}
        selectedCourtId={selectedCourtId}
        attributionPosition="bottom-left"
      />
      {/* One shared top row: [spacer 44][centered toggle][filter 44]. The
          toggle stays visually centered (both sides reserve the button's
          width) and can never overlap the filter button, at any screen
          width or OS font scale. The map's geolocate control renders in
          the spacer slot underneath, so the spacer must not eat clicks. */}
      <View
        pointerEvents="box-none"
        style={[styles.chrome, { top: insets.top + 12 }]}
      >
        <View pointerEvents="none" style={styles.chromeSpacer} />
        <View pointerEvents="box-none" style={styles.chromeCenter}>
          <SegmentedToggle
            options={[
              { key: "now", label: "Now" },
              { key: "all", label: "All courts" },
            ]}
            value={mode}
            onChange={(key) => setMode(key as "now" | "all")}
          />
        </View>
        <Pressable
          onPress={() => setFilterSheetOpen(true)}
          style={({ pressed }) => [
            styles.filterButton,
            t.shadows.chrome,
            {
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
      </View>
      <View
        pointerEvents="box-none"
        style={[styles.chromeCentered, { top: insets.top + 66 }]}
      >
        <DiscoverySearchButton onPress={() => setSearchOpen(true)} />
      </View>
      <View
        pointerEvents="box-none"
        style={[styles.chromeCentered, { top: insets.top + 112 }]}
      >
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
            t.shadows.chrome,
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
      </View>
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
      <DiscoverySearchSheet
        visible={searchOpen}
        bias={searchBias}
        onCourt={selectSearchCourt}
        onArea={selectSearchArea}
        onClose={() => setSearchOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapArea: { flex: 1 },
  desktopRow: { flex: 1, flexDirection: "row" },
  mapPane: { flex: 1 },
  statusChip: {
    position: "absolute",
    left: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  filterButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  // Desktop keeps the button floating on the map pane; on mobile it lives
  // in the shared top chrome row instead.
  filterButtonFloating: {
    position: "absolute",
    right: 16,
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
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  chromeSpacer: {
    width: 44,
  },
  chromeCenter: {
    flex: 1,
    alignItems: "center",
  },
  chromeCentered: {
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
