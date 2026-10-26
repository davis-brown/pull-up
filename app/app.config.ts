import type { ExpoConfig } from "expo/config";

// Typed locally: the app tsconfig has no node types, and this file only ever
// executes under Node (expo-cli / EAS).
declare const require: (id: string) => unknown;
const { existsSync } = require("fs") as { existsSync: (path: string) => boolean };

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

// Location purpose strings, shared by Info.plist and the expo-location plugin.
// The plugin writes these keys after infoPlist is applied, so passing a
// different string to each would silently ship the plugin's copy.
const LOCATION_WHEN_IN_USE =
  "pull-up uses your location to show nearby courts and to verify you're at a court when you check in.";
const LOCATION_ALWAYS =
  "With auto check-in enabled, pull-up detects when you arrive at a basketball court so you can check in without opening the app. Only court arrivals are used — your location history is never stored.";

// Required-reason API declarations for the app target (React Native core and
// Expo modules); the reasons follow Expo's documented React Native baseline.
// Collected data types mirror the Privacy Policy (app/privacy.tsx) and must
// match the App Privacy answers in App Store Connect. Nothing is used for
// tracking.
const collected = (type: string, linked = true) => ({
  NSPrivacyCollectedDataType: `NSPrivacyCollectedDataType${type}`,
  NSPrivacyCollectedDataTypeLinked: linked,
  NSPrivacyCollectedDataTypeTracking: false,
  NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
});

// Maps: MapLibre + OpenFreeMap tiles — no API keys or tokens required.
const config: ExpoConfig = {
  name: "pull-up",
  slug: "pull-up",
  owner: "davis-team",
  version: "1.0.0",
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
      NSLocationWhenInUseUsageDescription: LOCATION_WHEN_IN_USE,
      NSLocationAlwaysAndWhenInUseUsageDescription: LOCATION_ALWAYS,
      // Opt-in auto check-in: geofence arrivals take a one-shot fix and the
      // check-out runs on region exit, both with the app in the background.
      // App Review needs this explained in the review notes (2.5.4).
      UIBackgroundModes: ["location"],
      // Standard HTTPS only — skips the App Store export-compliance questionnaire.
      ITSAppUsesNonExemptEncryption: false,
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["0A2A.1", "3B52.1", "C617.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
      ],
      NSPrivacyCollectedDataTypes: [
        collected("EmailAddress"),
        collected("Name"),
        collected("UserID"),
        collected("PreciseLocation"),
        collected("PhotosorVideos"),
        collected("OtherUserContent"),
        // Sentry crash reports have the user stripped in beforeSend.
        collected("CrashData", false),
      ],
    },
  },
  android: {
    package: "com.pullup.app",
    // Guarded so builds work before the Firebase file exists.
    ...(existsSync("./google-services.json")
      ? { googleServicesFile: "./google-services.json" }
      : {}),
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
    // Tokens are stored without biometric gating; false drops the plugin's
    // generic NSFaceIDUsageDescription.
    ["expo-secure-store", { faceIDPermission: false }],
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
        locationWhenInUsePermission: LOCATION_WHEN_IN_USE,
        locationAlwaysAndWhenInUsePermission: LOCATION_ALWAYS,
        locationAlwaysPermission: LOCATION_ALWAYS,
        // No motion APIs are used; without false the plugin adds a generic
        // NSMotionUsageDescription that App Review flags (5.1.1).
        motionUsagePermission: false,
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    "expo-notifications",
    // expo-task-manager is auto-applied (it always adds the "fetch" background
    // mode); this strips "fetch" again, see the plugin for why.
    "./plugins/withoutBackgroundFetch",
    "expo-apple-authentication",
    "expo-sharing",
    [
      "expo-image-picker",
      {
        photosPermission: "pull-up uses your photo library so you can add pictures of courts.",
        // Library picking only. false keeps the plugin's generic camera and
        // microphone strings (and Android RECORD_AUDIO) out of the build.
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
    "@maplibre/maplibre-react-native",
    [
      "@sentry/react-native/expo",
      {
        // Source maps upload in EAS builds when SENTRY_AUTH_TOKEN is set;
        // local dev builds skip it silently.
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
