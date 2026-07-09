// Registers this device's Expo push token with the API so the server can
// send "run starting at your favorite court" notifications.
//
// Requires an EAS project (Constants.expoConfig.extra.eas.projectId — created
// by `eas init`); without one, or on web, this is a silent no-op.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

export async function registerPushToken(opts?: {
  requestPermission?: boolean;
}): Promise<void> {
  if (Platform.OS === "web") return;
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
    await api<void>("/me/push-token", {
      method: "POST",
      body: JSON.stringify({ token: token.data }),
    });
  } catch {
    // Push is best-effort; never block login on it.
  }
}
