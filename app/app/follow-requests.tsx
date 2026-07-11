import { useRouter, type Href } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { useAcceptFollowRequest, useFollowRequests, useRejectFollowRequest } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";

export default function FollowRequestsScreen() {
  const t = useTheme();
  const router = useRouter();
  const { data, isLoading } = useFollowRequests();
  const accept = useAcceptFollowRequest();
  const reject = useRejectFollowRequest();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <ActivityIndicator size="large" color={t.colors.accent} />
      </View>
    );
  }
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(u) => u.id}
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.md }}
      ListEmptyComponent={<EmptyState icon="person-add-outline" title="No follow requests" />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Pressable style={styles.who} onPress={() => router.push(`/user/${item.id}` as Href)}>
            <Avatar avatarUrl={item.avatar_url} displayName={item.display_name} seed={item.id} size={40} />
            <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]} numberOfLines={1}>
              {item.display_name}
            </Text>
          </Pressable>
          <View style={styles.actions}>
            <Button title="Confirm" busy={accept.isPending} onPress={() => accept.mutate(item.id)} />
            <Button title="Delete" variant="secondary" busy={reject.isPending} onPress={() => reject.mutate(item.id)} />
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 8 },
  who: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
});
