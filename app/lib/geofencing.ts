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
import { api, getExpectedUserId, onSessionExpired } from "./api";
import { parseRouteId, safePathSegment } from "./routes";
import { backgroundStorage as storage } from "./storage";
import type { CheckIn, CourtDetail, CourtSummary } from "./types";

class AccountChangedError extends Error {
  constructor() {
    super("Account changed during geofence task");
    this.name = "AccountChangedError";
  }
}

const GEOFENCE_TASK = "pullup-court-geofence";
const ACTIVE_USER_KEY = "pullup.geofence_user";
const LEGACY_MODE_KEY = "pullup.geofence_mode";
const MODE_KEY_PREFIX = "pullup.geofence_mode.";
const CONSENT_KEY_PREFIX = "pullup.geofence_consent.";
const REGION_RADIUS_M = 150;
const MAX_REGIONS = 15;

export type GeofenceMode = "off" | "prompt" | "auto";

export const geofencingSupported = Platform.OS !== "web";

const modeKey = (userId: string) => `${MODE_KEY_PREFIX}${userId}`;
const consentKey = (userId: string) => `${CONSENT_KEY_PREFIX}${userId}`;

let geofenceGeneration = 0;
let userTransition: Promise<void> = Promise.resolve();

async function activeUserId(): Promise<string | null> {
  return storage.get(ACTIVE_USER_KEY);
}

export async function getGeofenceMode(): Promise<GeofenceMode> {
  const userId = await activeUserId();
  if (!userId || (await storage.get(consentKey(userId))) !== "true") return "off";
  const stored = await storage.get(modeKey(userId));
  return stored === "prompt" || stored === "auto" ? stored : "off";
}

async function stopGeofencing(): Promise<void> {
  if (!geofencingSupported) return;
  if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(GEOFENCE_TASK);
  }
}

export function setGeofencingUser(userId: string): Promise<void> {
  const generation = ++geofenceGeneration;
  userTransition = userTransition
    .catch(() => {})
    .then(async () => {
      await storage.remove(ACTIVE_USER_KEY);
      await stopGeofencing();
      if (generation !== geofenceGeneration) return;
      // The old unscoped value cannot be assigned safely to whichever account
      // happens to sign in first after the upgrade.
      await storage.remove(LEGACY_MODE_KEY);
      await storage.set(ACTIVE_USER_KEY, userId);
    });
  return userTransition;
}

export function deactivateGeofencing(): Promise<void> {
  const generation = ++geofenceGeneration;
  userTransition = userTransition
    .catch(() => {})
    .then(async () => {
      await storage.remove(ACTIVE_USER_KEY);
      await storage.remove(LEGACY_MODE_KEY);
      try {
        await stopGeofencing();
      } catch {
        // With no active user, a still-delivered OS event is a no-op.
      }
      if (generation !== geofenceGeneration) return;
    });
  return userTransition;
}

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
    const courtId = parseRouteId(region.identifier);
    if (!courtId) return;
    const expectedUser = getExpectedUserId();
    const mode = await getGeofenceMode();
    if (mode === "off") return;
    try {
      if (eventType === Location.GeofencingEventType.Enter) {
        await onEnter(courtId, mode, expectedUser);
      } else if (eventType === Location.GeofencingEventType.Exit) {
        await onExit(courtId, expectedUser);
      }
    } catch {
      // Background context: nothing to surface; the next event retries.
    }
  });
}

function checkAccountLease(expectedUser: string | null): void {
  if (expectedUser !== getExpectedUserId()) {
    throw new AccountChangedError();
  }
}

async function onEnter(courtId: string, mode: GeofenceMode, leaseUser: string | null): Promise<void> {
  const segment = safePathSegment(courtId);
  checkAccountLease(leaseUser);
  const court = await api<CourtDetail>(`/courts/${segment}`);
  checkAccountLease(leaseUser);

  if (mode === "prompt") {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `Looks like you're at ${court.name}`,
        body: "Tap to check in and let others know there's a run.",
        data: { courtId, kind: "geofence_prompt" },
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
  checkAccountLease(leaseUser);
  await api<CheckIn>(`/courts/${segment}/check-ins`, {
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

async function onExit(courtId: string, leaseUser: string | null): Promise<void> {
  checkAccountLease(leaseUser);
  // Only automatic check-ins are auto-closed; a manual check-in is the
  // user's own statement and stays until they leave it or it expires.
  const res = await api<{ check_in: CheckIn | null }>("/me/check-ins/current");
  checkAccountLease(leaseUser);
  const current = res.check_in;
  if (current && current.court_id === courtId && current.source === "geofence_auto") {
    await api<void>("/check-ins/current", { method: "DELETE" });
  }
}

// Re-registers geofences around the nearest courts. Call after enabling,
// and opportunistically on app launch/foreground — iOS's 20-region cap
// means the monitored set must follow the user around.
export async function refreshGeofences(): Promise<void> {
  if (!geofencingSupported) return;
  const generation = geofenceGeneration;
  const userId = await activeUserId();
  if (!userId) return;
  if ((await getGeofenceMode()) === "off") return;
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== Location.PermissionStatus.GRANTED) return;

  const pos =
    (await Location.getLastKnownPositionAsync({
      maxAge: 5 * 60 * 1000,
      requiredAccuracy: 1_000,
    })) ??
    (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const res = await api<{ courts: CourtSummary[] }>(
    "/courts/search",
    {
      method: "POST",
      body: JSON.stringify({
        query: `lat=${pos.coords.latitude}&lng=${pos.coords.longitude}&radius_m=20000`,
      }),
    },
  );
  const regions = res.courts.slice(0, MAX_REGIONS).map((c) => ({
    identifier: c.id,
    latitude: c.lat,
    longitude: c.lng,
    radius: REGION_RADIUS_M,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  if (generation !== geofenceGeneration || (await activeUserId()) !== userId) return;
  if (regions.length === 0) {
    await stopGeofencing();
    return;
  }
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

  const generation = geofenceGeneration;
  const userId = await activeUserId();
  if (!userId) return { ok: false, reason: "Sign in to enable auto check-in." };

  if (mode === "off") {
    await storage.set(modeKey(userId), mode);
    if (
      generation !== geofenceGeneration ||
      (await activeUserId()) !== userId
    ) {
      return { ok: false, reason: "Your account changed. Try again." };
    }
    await stopGeofencing();
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
  if (!notif.granted) {
    return { ok: false, reason: "Notifications are required for auto check-in." };
  }
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Check-ins",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  if (
    generation !== geofenceGeneration ||
    (await activeUserId()) !== userId
  ) {
    return { ok: false, reason: "Your account changed. Try again." };
  }
  await storage.set(consentKey(userId), "true");
  await storage.set(modeKey(userId), mode);
  await refreshGeofences();
  return { ok: true };
}

// Headless geofence launches do not mount AuthProvider. A definitively dead
// refresh session must still disable OS monitoring and clear the active user.
onSessionExpired(() => {
  void deactivateGeofencing().catch(() => {});
});
