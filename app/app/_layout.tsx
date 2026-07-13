import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Barlow_400Regular,
  Barlow_500Medium,
  Barlow_600SemiBold,
  Barlow_700Bold,
} from "@expo-google-fonts/barlow";
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from "@expo-google-fonts/barlow-condensed";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { AuthProvider } from "@/lib/auth-context";
// Side-effect import: registers the geofence background task at startup so
// headless launches (geofence event with the app killed) can handle events.
import { geofencingSupported, refreshGeofences } from "@/lib/geofencing";
import { onboardingSeen } from "@/lib/first-run";
import { navChrome, ThemePreferenceProvider, useTheme } from "@/lib/theme";

const sentryDSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (sentryDSN) {
  Sentry.init({
    dsn: sentryDSN,
    // Crash + error reporting only; no session replay, no PII.
    sendDefaultPii: false,
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

// Hold the splash screen until Barlow is loaded so the type scale never
// flashes system fonts — but never hang forever: fall back to system fonts
// after 3s if the font fetch stalls (slow network, offline first launch).
void SplashScreen.preventAutoHideAsync().catch(() => {});
const FONT_LOAD_TIMEOUT_MS = 3000;

function useAppReady(): boolean {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
  });
  const [timedOut, setTimedOut] = useState(false);
  const hidden = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = fontsLoaded || !!fontError || timedOut;

  useEffect(() => {
    if (ready && !hidden.current) {
      hidden.current = true;
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  return ready;
}

// Split from RootLayout so useTheme() sees the preference provider.
function ThemedApp() {
  const t = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!geofencingSupported) return;
    // Keep the monitored courts current with wherever the user is now.
    void refreshGeofences().catch(() => {});
    // Tapping a geofence notification opens that court.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const courtId = response.notification.request.content.data?.courtId;
      if (typeof courtId === "string") {
        router.push(`/court/${courtId}`);
      }
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    // First launch: show the welcome carousel once, before anything else.
    void onboardingSeen().then((seen) => {
      if (!seen) router.replace("/onboarding");
    });
  }, [router]);

  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={navChrome(t)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="court/[id]/index" options={{ title: "Court" }} />
        <Stack.Screen
          name="court/[id]/report"
          options={{ title: "Report the crowd", presentation: "modal" }}
        />
        <Stack.Screen
          name="court/[id]/plan"
          options={{ title: "Plan a run", presentation: "modal" }}
        />
        <Stack.Screen
          name="court/[id]/edit"
          options={{ title: "Suggest an edit", presentation: "modal" }}
        />
        <Stack.Screen
          name="court/new"
          options={{ title: "Add a court", presentation: "modal" }}
        />
        <Stack.Screen name="user/[id]/index" options={{ title: "Player" }} />
        <Stack.Screen name="user/[id]/followers" options={{ title: "Followers" }} />
        <Stack.Screen name="user/[id]/following" options={{ title: "Following" }} />
        <Stack.Screen name="follow-requests" options={{ title: "Follow requests" }} />
        <Stack.Screen name="flag" options={{ title: "Report", presentation: "modal" }} />
        <Stack.Screen name="admin/index" options={{ title: "Moderation" }} />
        <Stack.Screen
          name="location-disclosure"
          options={{ title: "Auto check-in", presentation: "modal" }}
        />
        <Stack.Screen name="privacy" options={{ title: "Privacy Policy" }} />
        <Stack.Screen name="terms" options={{ title: "Terms of Service" }} />
      </Stack>
    </>
  );
}

function RootLayout() {
  const ready = useAppReady();
  // Native splash screen is still showing until hideAsync() fires above, so
  // rendering nothing here just avoids a flash of unstyled content.
  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemePreferenceProvider>
          <ThemedApp />
        </ThemePreferenceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default sentryDSN ? Sentry.wrap(RootLayout) : RootLayout;
