import { useRouter, type Href } from "expo-router";
import type { UseQueryResult } from "@tanstack/react-query";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { FullScreenLoader } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { safePathSegment } from "@/lib/routes";
import type { FollowUser } from "@/lib/types";

export function FollowList({
  query,
  emptyText,
}: {
  query: UseQueryResult<FollowUser[]>;
  emptyText: string;
}) {
  const t = useTheme();
  const router = useRouter();
  const { data, isLoading, error, refetch } = query;
  if (isLoading) {
    return <FullScreenLoader />;
  }
  if (error && !data) {
    const privateList = error instanceof ApiError && error.status === 403;
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError
          error={error}
          onRetry={privateList ? undefined : () => void refetch()}
          title={privateList ? "This account is private" : undefined}
          message={privateList ? "Follow this player to see their connections." : undefined}
        />
      </View>
    );
  }
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(u) => u.id}
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.md }}
      ListEmptyComponent={<EmptyState icon="people-outline" title={emptyText} />}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => router.push(`/user/${safePathSegment(item.id)}` as Href)}>
          <Avatar avatarUrl={item.avatar_url} displayName={item.display_name} seed={item.id} size={40} />
          <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>{item.display_name}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
});
