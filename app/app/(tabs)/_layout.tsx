import { Tabs } from "expo-router";
import { Text } from "react-native";
import { AuthGate } from "@/components/AuthGate";

function TabIcon({ emoji }: { emoji: string }) {
  return <Text style={{ fontSize: 22 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <AuthGate>
      <Tabs screenOptions={{ tabBarActiveTintColor: "#e8590c" }}>
        <Tabs.Screen
          name="index"
          options={{
            title: "Map",
            headerShown: false,
            tabBarIcon: () => <TabIcon emoji="🗺️" />,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: "Activity",
            tabBarIcon: () => <TabIcon emoji="🏀" />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: () => <TabIcon emoji="👤" />,
          }}
        />
      </Tabs>
    </AuthGate>
  );
}
