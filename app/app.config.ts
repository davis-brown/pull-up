import type { ExpoConfig } from "expo/config";

// Host for universal links (iOS) / app links (Android), from the same origin
// used to build share links. Falls back to the production domain.
const configuredWebUrl = process.env.EXPO_PUBLIC_WEB_URL ?? "https://pull-up.davisbrown.dev";
let webHost = "pull-up.davisbrown.dev";
try {
  const parsed = new URL(configuredWebUrl);
  if (parsed.protocol === "https:" || parsed.protocol === "http:") {
    webHost = parsed.host;
  }
} catch {
  // Keep the production host for invalid build-time configuration.
}

// Maps: MapLibre + OpenFreeMap tiles — no API keys or tokens required.
const config: ExpoConfig = {
  name: "pull-up",
  slug: "pull-up",
  owner: "davis-team",
  version: "0.1.0",
  scheme: "pullup",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.pullup.app",
    supportsTablet: false,
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${webHost}`],
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "pull-up uses your location to show nearby courts and to verify you're at a court when you check in.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "With auto check-in enabled, pull-up detects when you arrive at a basketball court so you can check in without opening the app. Only court arrivals are used — your location history is never stored.",
      UIBackgroundModes: ["location"],
      // Standard HTTPS only — skips the App Store export-compliance questionnaire.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "com.pullup.app",
    adaptiveIcon: {
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          { scheme: "https", host: webHost, pathPrefix: "/court" },
          { scheme: "https", host: webHost, pathPrefix: "/verify-email" },
        ],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    permissions: [
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
    ],
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        // Theme background tokens (lib/theme.ts): titanium light, gunmetal dark.
        backgroundColor: "#F2F4F8",
        dark: {
          image: "./assets/splash-icon.png",
          backgroundColor: "#0C0E12",
        },
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "pull-up uses your location to show nearby courts and to verify you're at a court when you check in.",
        locationAlwaysAndWhenInUsePermission:
          "With auto check-in enabled, pull-up detects when you arrive at a basketball court so you can check in without opening the app.",
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    "expo-notifications",
    "expo-task-manager",
    "expo-apple-authentication",
    "expo-sharing",
    [
      "expo-image-picker",
      {
        photosPermission: "pull-up uses your photo library so you can add pictures of courts.",
      },
    ],
    "@maplibre/maplibre-react-native",
    [
      "@sentry/react-native/expo",
      {
        // Source-map upload happens in EAS builds when SENTRY_AUTH_TOKEN is
        // present in the build env; local dev builds skip it silently.
        organization: process.env.SENTRY_ORG ?? "",
        project: process.env.SENTRY_PROJECT ?? "pull-up",
      },
    ],
  ],
  extra: {
    eas: {
      // Push notifications: getExpoPushTokenAsync needs this to mint tokens.
      projectId: "e89a09a0-ef95-412b-82fb-f1b5075058d8",
    },
  },
  experiments: {
    typedRoutes: true,
  },
};

export default config;
