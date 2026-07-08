import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Card, ErrorText, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  useAdminActions,
  useAdminFlags,
  useAdminSearchUsers,
  useAdminSetCourtStatus,
  useAdminSetPhotoStatus,
  useResolveFlag,
  useSetUserAdmin,
} from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { AdminUser, Flag } from "@/lib/types";

const entityLabels: Record<Flag["entity_type"], string> = {
  court: "Court",
  photo: "Photo",
  report: "Crowd report",
};

function SectionLabel({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
      {children}
    </Text>
  );
}

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

function UserRow({ user, onError }: { user: AdminUser; onError: (e: Error) => void }) {
  const t = useTheme();
  const setUserAdmin = useSetUserAdmin();

  return (
    <View style={[styles.userRow, { borderTopColor: t.colors.border }]}>
      <View style={styles.userInfo}>
        <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]} numberOfLines={1}>
          {user.display_name}
        </Text>
        <Text style={[t.type.caption, { color: t.colors.textMuted }]} numberOfLines={1}>
          {user.email}
        </Text>
      </View>
      <Button
        title={user.is_admin ? "Demote" : "Promote"}
        variant={user.is_admin ? "danger" : "secondary"}
        busy={setUserAdmin.isPending}
        onPress={() =>
          setUserAdmin.mutate(
            { userId: user.id, isAdmin: !user.is_admin },
            { onError },
          )
        }
      />
    </View>
  );
}

function AdminManagementCard() {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: results, isFetching } = useAdminSearchUsers(submitted);

  return (
    <Card>
      <SectionLabel>Admins</SectionLabel>
      <Field
        label="Find a user"
        value={query}
        onChangeText={setQuery}
        placeholder="Name or email"
        onSubmitEditing={() => setSubmitted(query)}
        returnKeyType="search"
      />
      <Button
        title="Search"
        variant="secondary"
        busy={isFetching}
        onPress={() => setSubmitted(query)}
      />
      <ErrorText message={error} />
      {submitted.trim() !== "" && !isFetching && (results?.length ?? 0) === 0 && (
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          No users match "{submitted}".
        </Text>
      )}
      {results?.map((u) => (
        <UserRow key={u.id} user={u} onError={(e) => setError(e.message)} />
      ))}
    </Card>
  );
}

function AdminActionsCard() {
  const t = useTheme();
  const { data: actions } = useAdminActions();
  if ((actions?.length ?? 0) === 0) return null;

  return (
    <Card>
      <SectionLabel>Recent admin activity</SectionLabel>
      {actions!.map((a) => (
        <View key={a.id} style={[styles.userRow, { borderTopColor: t.colors.border }]}>
          <Text style={[t.type.caption, { color: t.colors.textSecondary, flex: 1 }]}>
            <Text style={{ fontWeight: "600" }}>{a.actor_name}</Text>{" "}
            {a.action === "promote" ? "promoted" : "demoted"}{" "}
            <Text style={{ fontWeight: "600" }}>{a.target_name}</Text>
          </Text>
          <Text style={[t.type.caption, { color: t.colors.textMuted }]}>
            {new Date(a.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}
          </Text>
        </View>
      ))}
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
        <SectionLabel>Flags</SectionLabel>
        {isLoading ? (
          <ActivityIndicator size="large" color={t.colors.accent} />
        ) : (flags?.length ?? 0) === 0 ? (
          <Text style={[t.type.body, { color: t.colors.textSecondary, marginBottom: t.spacing.md }]}>
            No open reports — the queue is clear.
          </Text>
        ) : (
          flags!.map((flag) => <FlagRow key={flag.id} flag={flag} />)
        )}

        <AdminManagementCard />
        <AdminActionsCard />
      </ScrollView>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  actionButton: { flexGrow: 1 },
  userRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  userInfo: { flex: 1 },
});
