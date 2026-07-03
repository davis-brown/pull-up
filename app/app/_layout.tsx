import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/lib/auth-context";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="court/[id]/index" options={{ title: "Court" }} />
          <Stack.Screen
            name="court/[id]/report"
            options={{ title: "Report the crowd", presentation: "modal" }}
          />
          <Stack.Screen
            name="court/new"
            options={{ title: "Add a court", presentation: "modal" }}
          />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
