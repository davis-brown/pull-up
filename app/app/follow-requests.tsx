import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { AuthGate } from "@/components/AuthGate";
import { Button, ErrorText, FullScreenLoader } from "@/components/ui";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { useAcceptFollowRequest, useFollowRequests, useRejectFollowRequest } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import { safePathSegment } from "@/lib/routes";

export default function FollowRequestsScreen() {
  return (
    <AuthGate>
      <FollowRequestsContent />
    </AuthGate>
  );
}

function FollowRequestsContent() {
  const t = useTheme();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useFollowRequests();
  const accept = useAcceptFollowRequest();
  const reject = useRejectFollowRequest();
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (isLoading) {
    return <FullScreenLoader />;
  }
  if (error && !data) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={error} onRetry={() => void refetch()} />
      </View>
    );
  }
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={(u) => u.id}
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.md }}
      ListHeaderComponent={<ErrorText message={mutationError} />}
      ListEmptyComponent={<EmptyState icon="person-add-outline" title="No follow requests" />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Pressable style={styles.who} onPress={() => router.push(`/user/${safePathSegment(item.id)}` as Href)}>
            <Avatar avatarUrl={item.avatar_url} displayName={item.display_name} seed={item.id} size={40} />
            <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]} numberOfLines={1}>
              {item.display_name}
            </Text>
          </Pressable>
          <View style={styles.actions}>
            <Button
              title="Confirm"
              busy={accept.isPending}
              onPress={() => {
                setMutationError(null);
                accept.mutate(item.id, { onError: (e) => setMutationError(e.message) });
              }}
            />
            <Button
              title="Delete"
              variant="secondary"
              busy={reject.isPending}
              onPress={() => {
                setMutationError(null);
                reject.mutate(item.id, { onError: (e) => setMutationError(e.message) });
              }}
            />
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
