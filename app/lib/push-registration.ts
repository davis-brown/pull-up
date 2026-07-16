// Registers this device's Expo push token with the API so the server can
// send "run starting at your favorite court" notifications.
//
// Requires an EAS project (Constants.expoConfig.extra.eas.projectId — created
// by `eas init`); without one, or on web, this is a silent no-op.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";
import { storage } from "./storage";

const PUSH_TOKEN_KEY_PREFIX = "pullup.push_token.";

let activeUserId: string | null = null;
let registrationGeneration = 0;
const memoryTokens = new Map<string, string>();

const tokenKey = (userId: string) => `${PUSH_TOKEN_KEY_PREFIX}${userId}`;

export function setPushRegistrationUser(userId: string): void {
  registrationGeneration += 1;
  activeUserId = userId;
}

export async function cancelPushTokenAssociation(
  userId: string | null,
): Promise<{ token: string | null; commit: () => Promise<void> } | null> {
  registrationGeneration += 1;
  activeUserId = null;
  if (!userId || Platform.OS === "web") return null;
  let token = memoryTokens.get(userId) ?? null;
  if (!token) {
    try {
      token = await storage.get(tokenKey(userId));
    } catch {
      // The in-memory token is still enough when available.
    }
  }
  memoryTokens.delete(userId);
  const commit = async () => {
    try {
      await storage.remove(tokenKey(userId));
    } catch {
      // Best-effort cleanup.
    }
  };
  return { token, commit };
}

export async function getStoredPushToken(userId: string): Promise<string | null> {
  return memoryTokens.get(userId) ?? storage.get(tokenKey(userId)).catch(() => null);
}

export async function registerPushToken(opts?: {
  requestPermission?: boolean;
}): Promise<void> {
  if (Platform.OS === "web") return;
  const userId = activeUserId;
  const generation = registrationGeneration;
  if (!userId) return;
  try {
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) {
      // Only prompt when the caller has just primed the user (first
      // favorite). Sign-in must not fire a surprise permission dialog.
      if (!opts?.requestPermission) return;
      const req = await Notifications.requestPermissionsAsync();
      if (!req.granted) return;
    }
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    if (generation !== registrationGeneration || activeUserId !== userId) return;
    memoryTokens.set(userId, token.data);
    await storage.set(tokenKey(userId), token.data);
    if (generation !== registrationGeneration || activeUserId !== userId) {
      memoryTokens.delete(userId);
      await storage.remove(tokenKey(userId));
      return;
    }
    await api<void>("/me/push-token", {
      method: "POST",
      body: JSON.stringify({ token: token.data }),
    });
  } catch {
    // Push is best-effort; never block login on it.
  }
}
