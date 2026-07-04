import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Card, ErrorText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  useAdminFlags,
  useAdminSetCourtStatus,
  useAdminSetPhotoStatus,
  useResolveFlag,
} from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { Flag } from "@/lib/types";

const entityLabels: Record<Flag["entity_type"], string> = {
  court: "Court",
  photo: "Photo",
  report: "Crowd report",
};

function FlagRow({ flag }: { flag: Flag }) {
  const t = useTheme();
  const router = useRouter();
  const resolveFlag = useResolveFlag();
  const setCourtStatus = useAdminSetCourtStatus();
  const setPhotoStatus = useAdminSetPhotoStatus();
  const [error, setError] = useState<string | null>(null);

  const busy = resolveFlag.isPending || setCourtStatus.isPending || setPhotoStatus.isPending;
  const onError = (e: Error) => setError(e.message);

  return (
    <Card>
      <View style={styles.headerRow}>
        <Text style={[t.type.label, { color: t.colors.accent }]}>
          {entityLabels[flag.entity_type]}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textMuted }]}>
          {new Date(flag.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
        </Text>
      </View>
      <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary, marginTop: t.spacing.xs }]}>
        {flag.reason}
      </Text>
      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 2 }]}>
        Reported by {flag.reporter}
      </Text>
      <ErrorText message={error} />
      <View style={[styles.actions, { marginTop: t.spacing.sm }]}>
        {flag.entity_type === "court" && (
          <>
            <View style={styles.actionButton}>
              <Button
                title="View"
                variant="secondary"
                onPress={() => router.push(`/court/${flag.entity_id}`)}
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                title="Reject court"
                variant="danger"
                busy={busy}
                onPress={() =>
                  setCourtStatus.mutate(
                    { courtId: flag.entity_id, status: "rejected" },
                    { onSuccess: () => resolveFlag.mutate(flag.id, { onError }), onError },
                  )
                }
              />
            </View>
          </>
        )}
        {flag.entity_type === "photo" && (
          <View style={styles.actionButton}>
            <Button
              title="Remove photo"
              variant="danger"
              busy={busy}
              onPress={() =>
                setPhotoStatus.mutate(
                  { photoId: flag.entity_id, status: "removed" },
                  { onSuccess: () => resolveFlag.mutate(flag.id, { onError }), onError },
                )
              }
            />
          </View>
        )}
        <View style={styles.actionButton}>
          <Button
            title="Resolve"
            variant="ghost"
            busy={busy}
            onPress={() => resolveFlag.mutate(flag.id, { onError })}
          />
        </View>
      </View>
    </Card>
  );
}

export default function AdminScreen() {
  const { user } = useAuth();
  const t = useTheme();
  const { data: flags, isLoading } = useAdminFlags();

  if (!user?.is_admin) {
    return <Redirect href="/profile" />;
  }

  return (
    <AuthGate>
      <ScrollView
        style={{ backgroundColor: t.colors.background }}
        contentContainerStyle={{ padding: t.spacing.lg }}
      >
        {isLoading ? (
          <ActivityIndicator size="large" color={t.colors.accent} />
        ) : (flags?.length ?? 0) === 0 ? (
          <Text style={[t.type.body, { color: t.colors.textSecondary }]}>
            No open reports — the queue is clear.
          </Text>
        ) : (
          flags!.map((flag) => <FlagRow key={flag.id} flag={flag} />)
        )}
      </ScrollView>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionButton: { flexGrow: 1 },
});
