const values = new Map<string, string>();
const stopGeofencing = jest.fn(async () => {});
let started = false;
let sessionExpired: (() => void) | undefined;

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("expo-location", () => ({
  Accuracy: { High: 1, Balanced: 2 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  PermissionStatus: { GRANTED: "granted" },
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 1, longitude: 2 },
  })),
  getLastKnownPositionAsync: jest.fn(async () => ({
    coords: { latitude: 1, longitude: 2 },
  })),
  hasStartedGeofencingAsync: jest.fn(async () => started),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  startGeofencingAsync: jest.fn(async () => {
    started = true;
  }),
  stopGeofencingAsync: stopGeofencing,
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { DEFAULT: 3 },
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => "notification"),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("./api", () => ({
  api: jest.fn(async () => ({ courts: [] })),
  onSessionExpired: jest.fn((listener: () => void) => {
    sessionExpired = listener;
    return () => {};
  }),
}));
jest.mock("./storage", () => ({
  storage: {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    remove: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  },
  backgroundStorage: {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    remove: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  },
}));

import {
  deactivateGeofencing,
  getGeofenceMode,
  setGeofenceMode,
  setGeofencingUser,
} from "./geofencing";

beforeEach(() => {
  values.clear();
  started = false;
  stopGeofencing.mockClear();
});

it("scopes mode and consent by user and disables monitoring without an identity", async () => {
  await setGeofencingUser("user-a");
  await expect(getGeofenceMode()).resolves.toBe("off");
  await expect(setGeofenceMode("prompt")).resolves.toEqual({ ok: true });
  await expect(getGeofenceMode()).resolves.toBe("prompt");

  await setGeofencingUser("user-b");
  await expect(getGeofenceMode()).resolves.toBe("off");
  await expect(setGeofenceMode("auto")).resolves.toEqual({ ok: true });
  await expect(getGeofenceMode()).resolves.toBe("auto");

  await setGeofencingUser("user-a");
  await expect(getGeofenceMode()).resolves.toBe("prompt");

  sessionExpired?.();
  await deactivateGeofencing();
  await expect(getGeofenceMode()).resolves.toBe("off");
  expect(values.get("pullup.geofence_user")).toBeUndefined();
});
