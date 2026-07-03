import type { ExpoConfig } from "expo/config";

// EXPO_PUBLIC_MAPBOX_TOKEN: public pk.* token, safe to embed.
// MAPBOX_DOWNLOAD_TOKEN: secret sk.* token used only at native build time to
// download the Mapbox SDK — set it in EAS secrets / local env, never commit it.
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
    [
      "@rnmapbox/maps",
      {
        RNMapboxMapsDownloadToken: process.env.MAPBOX_DOWNLOAD_TOKEN,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
