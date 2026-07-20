import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
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
import { Pressable } from "react-native";
import * as Sentry from "@sentry/react-native";
import { AuthProvider } from "@/lib/auth-context";
// Side-effect import: registers the geofence background task at startup so
// headless launches (geofence event with the app killed) can handle events.
import { geofencingSupported, refreshGeofences } from "@/lib/geofencing";
import { onboardingSeen } from "@/lib/first-run";
import { dayOffsetFromToday } from "@/lib/run-intents";
import { WINDOW_SPANS } from "@/lib/your-window";
import { navChrome, ThemePreferenceProvider, useTheme } from "@/lib/theme";

const sentryDSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const telemetryId = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function sanitizeTelemetryUrl(value: string): string {
  try {
    const parsed = new URL(value, "https://telemetry.invalid");
    const path = parsed.pathname.replace(telemetryId, ":id");
    return parsed.origin === "https://telemetry.invalid" ? path : `${parsed.origin}${path}`;
  } catch {
    return value.split(/[?#]/, 1)[0]!.replace(telemetryId, ":id");
  }
}

if (sentryDSN) {
  Sentry.init({
    dsn: sentryDSN,
    // Crash + error reporting only; no session replay, no PII.
    sendDefaultPii: false,
    beforeBreadcrumb(breadcrumb) {
      const url = breadcrumb.data?.url;
      if (typeof url !== "string") return breadcrumb;
      return {
        ...breadcrumb,
        data: { ...breadcrumb.data, url: sanitizeTelemetryUrl(url) },
      };
    },
    beforeSend(event) {
      event.user = undefined;
      if (event.request) {
        event.request = {
          ...event.request,
          url: event.request.url ? sanitizeTelemetryUrl(event.request.url) : undefined,
          query_string: undefined,
          cookies: undefined,
          headers: undefined,
          data: undefined,
        };
      }
      return event;
    },
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
    // Tapping a geofence notification opens that court — except the
    // "looks like you're at X" prompt, which deep-links straight to the
    // slide-to-check-in screen instead.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      // Phase 20 pushes carry no court: a level-up opens the profile
      // (where the new level is), a streak nudge opens the map (where you
      // go do something about it).
      if (data?.action === "view_profile") {
        router.push("/profile");
        return;
      }
      if (data?.action === "view_map") {
        router.push("/");
        return;
      }
      const courtId = data?.courtId;
      if (typeof courtId !== "string") return;
      if (data?.kind === "geofence_prompt") {
        router.push(`/check-in?courtId=${courtId}&via=gps`);
        return;
      }
      // "Looking to play" pushes (phase 19): the threshold push opens the
      // plan screen prefilled from the bucket; the conversion push opens
      // the court with the newly-planned run highlighted (same ?run=
      // path shared links use).
      if (data?.action === "plan_run" && typeof data.runDate === "string" && typeof data.windowKey === "string") {
        const span = WINDOW_SPANS.find((w) => w.key === data.windowKey);
        const dayOffset = dayOffsetFromToday(data.runDate, new Date());
        const hourParam = span ? `&prefillHour=${span.start}` : "";
        router.push(`/court/${courtId}/plan?prefillDay=${dayOffset}${hourParam}`);
        return;
      }
      if (data?.action === "view_run" && typeof data.sessionId === "string") {
        router.push(`/court/${courtId}?run=${data.sessionId}`);
        return;
      }
      router.push(`/court/${courtId}`);
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
        <Stack.Screen
          name="profile-settings"
          options={{
            title: "Profile settings",
            // Reachable via deep link / direct URL / notification with no
            // prior history — fall back to home instead of a dead-end
            // screen with no back button.
            headerLeft: () => (
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
                hitSlop={8}
              >
                <Ionicons name="chevron-back" size={26} color={t.colors.textPrimary} />
              </Pressable>
            ),
          }}
        />
        <Stack.Screen name="flag" options={{ title: "Report", presentation: "modal" }} />
        <Stack.Screen name="admin/index" options={{ title: "Moderation" }} />
        <Stack.Screen
          name="location-disclosure"
          options={{ title: "Auto check-in", presentation: "modal" }}
        />
        <Stack.Screen
          name="check-in"
          options={{ headerShown: false, presentation: "modal" }}
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
