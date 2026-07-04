// Passive court geofencing (native only — background location does not exist
// on web). The OS monitors regions around the ~15 nearest courts; on entry we
// either prompt ("Looks like you're at X — check in?") or check in silently,
// per the user's Auto check-in setting. Exit auto-checks-out automatic
// check-ins. Uses OS-level region monitoring, not continuous GPS.
//
// iOS caps monitored regions at 20 per app, hence nearest-15 with
// re-registration on each refresh. The server re-verifies every check-in is
// within 150 m, so a drive-by geofence entry with a stale fix cannot create
// a bogus check-in far from the court.
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { api } from "./api";
import { storage } from "./storage";
import type { CheckIn, CourtDetail, CourtSummary } from "./types";

const GEOFENCE_TASK = "pullup-court-geofence";
const MODE_KEY = "pullup.geofence_mode";
const REGION_RADIUS_M = 150;
const MAX_REGIONS = 15;

export type GeofenceMode = "off" | "prompt" | "auto";

export const geofencingSupported = Platform.OS !== "web";

export async function getGeofenceMode(): Promise<GeofenceMode> {
  const stored = await storage.get(MODE_KEY);
  return stored === "prompt" || stored === "auto" ? stored : "off";
}

// --- background task ---------------------------------------------------

if (geofencingSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error || !data) return;
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };
    const courtId = region.identifier;
    if (!courtId) return;
    const mode = await getGeofenceMode();
    if (mode === "off") return;
    try {
      if (eventType === Location.GeofencingEventType.Enter) {
        await onEnter(courtId, mode);
      } else if (eventType === Location.GeofencingEventType.Exit) {
        await onExit(courtId);
      }
    } catch {
      // Background context: nothing to surface; the next event retries.
    }
  });
}

async function onEnter(courtId: string, mode: GeofenceMode): Promise<void> {
  const court = await api<CourtDetail>(`/courts/${courtId}`);

  if (mode === "prompt") {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Looks like you're at ${court.name}`,
        body: "Tap to check in and let others know there's a run.",
        data: { courtId },
      },
      trigger: null,
    });
    return;
  }

  // Automatic: take a fresh fix and check in. The server enforces the 150 m
  // radius, so a spurious entry event can't check us in from afar.
  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  await api<CheckIn>(`/courts/${courtId}/check-ins`, {
    method: "POST",
    body: JSON.stringify({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      source: "geofence_auto",
    }),
  });
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Checked in at ${court.name}`,
      body: "Auto check-in expires in 2 hours. Tap to view or check out.",
      data: { courtId },
    },
    trigger: null,
  });
}

async function onExit(courtId: string): Promise<void> {
  // Only automatic check-ins are auto-closed; a manual check-in is the
  // user's own statement and stays until they leave it or it expires.
  const res = await api<{ check_in: CheckIn | null }>("/me/check-ins/current");
  const current = res.check_in;
  if (current && current.court_id === courtId && current.source === "geofence_auto") {
    await api<void>("/check-ins/current", { method: "DELETE" });
  }
}

// --- registration & settings -------------------------------------------

// Re-registers geofences around the nearest courts. Call after enabling,
// and opportunistically on app launch/foreground — iOS's 20-region cap
// means the monitored set must follow the user around.
export async function refreshGeofences(): Promise<void> {
  if (!geofencingSupported) return;
  if ((await getGeofenceMode()) === "off") return;
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return;

  const pos =
    (await Location.getLastKnownPositionAsync()) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const res = await api<{ courts: CourtSummary[] }>(
    `/courts?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}&radius_m=20000`,
  );
  const regions = res.courts.slice(0, MAX_REGIONS).map((c) => ({
    identifier: c.id,
    latitude: c.lat,
    longitude: c.lng,
    radius: REGION_RADIUS_M,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  if (regions.length === 0) return;
  await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
}

export interface EnableResult {
  ok: boolean;
  reason?: string;
}

// Sets the mode, walking the permission ladder when turning it on:
// foreground location → background ("Always") location → notifications.
export async function setGeofenceMode(mode: GeofenceMode): Promise<EnableResult> {
  if (!geofencingSupported) {
    return { ok: false, reason: "Auto check-in needs the mobile app." };
  }

  if (mode === "off") {
    await storage.set(MODE_KEY, mode);
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
    return { ok: true };
  }

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== Location.PermissionStatus.GRANTED) {
    return { ok: false, reason: "Location permission is required." };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== Location.PermissionStatus.GRANTED) {
    return {
      ok: false,
      reason:
        Platform.OS === "ios"
          ? 'Allow location "Always" in Settings so courts can be detected in the background.'
          : "Allow background location in Settings so courts can be detected in the background.",
    };
  }
  const notif = await Notifications.requestPermissionsAsync();
  if (!notif.granted && mode === "prompt") {
    return { ok: false, reason: "Notifications are required for check-in prompts." };
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Check-ins",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await storage.set(MODE_KEY, mode);
  await refreshGeofences();
  return { ok: true };
}
