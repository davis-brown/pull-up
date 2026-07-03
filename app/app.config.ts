import type { ExpoConfig } from "expo/config";

// Maps: MapLibre + OpenFreeMap tiles — no API keys or tokens required.
const config: ExpoConfig = {
  name: "pull-up",
  slug: "pull-up",
  version: "0.1.0",
  scheme: "pullup",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.pullup.app",
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "pull-up uses your location to show nearby courts and to verify you're at a court when you check in.",
    },
  },
  android: {
    package: "com.pullup.app",
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"],
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "pull-up uses your location to show nearby courts and to verify you're at a court when you check in.",
      },
    ],
    "@maplibre/maplibre-react-native",
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
