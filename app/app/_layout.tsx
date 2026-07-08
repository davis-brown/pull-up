import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AuthProvider } from "@/lib/auth-context";
// Side-effect import: registers the geofence background task at startup so
// headless launches (geofence event with the app killed) can handle events.
import { geofencingSupported, refreshGeofences } from "@/lib/geofencing";
import { navChrome, ThemePreferenceProvider, useTheme } from "@/lib/theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

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

  return (
    <>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={navChrome(t)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
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
          name="court/new"
          options={{ title: "Add a court", presentation: "modal" }}
        />
        <Stack.Screen name="flag" options={{ title: "Report", presentation: "modal" }} />
        <Stack.Screen name="admin/index" options={{ title: "Moderation" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
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
