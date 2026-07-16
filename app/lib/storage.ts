import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const platformOS = Platform.OS;

// General preference storage. Authentication uses a single native-only record
// in api.ts; web localStorage is never used for live auth credentials.
export const storage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// Background geofence tasks need the active account and token pair after the
// first device unlock. This-device-only prevents backup/restore migration.
export const backgroundStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === "web") return storage.get(key);
    return SecureStore.getItemAsync(key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") return storage.set(key, value);
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === "web") return storage.remove(key);
    await SecureStore.deleteItemAsync(key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
};
