import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useSignInDetour } from "@/components/SignInCta";
import { Button, Card, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCancelSession, useCourtSessions, useRSVP } from "@/lib/hooks";
import { buildCourtLink, runShareMessage } from "@/lib/links";
import { useTheme } from "@/lib/theme";
import type { CourtSession } from "@/lib/types";

// "Today 6:00 PM", "Tomorrow 9:00 AM", "Sat 6:00 PM".
export function sessionTimeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

function SessionRow({
  session,
  courtId,
  courtName,
  highlighted,
}: {
  session: CourtSession;
  courtId: string;
  courtName: string;
  highlighted?: boolean;
}) {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const detour = useSignInDetour();
  const rsvp = useRSVP(courtId);
  const cancel = useCancelSession(courtId);
  const [error, setError] = useState<string | null>(null);

  const going = session.my_rsvp === "going";
  const mine = session.created_by === user?.id;

  return (
    <View
      style={[
        styles.row,
        {
          borderTopColor: t.colors.border,
          ...(highlighted
            ? {
                borderWidth: 1,
                borderTopWidth: 1,
                borderColor: t.colors.accent,
                borderTopColor: t.colors.accent,
                borderRadius: t.radius.md,
                paddingHorizontal: t.spacing.sm,
              }
            : null),
        },
      ]}
    >
      <View style={styles.rowBody}>
        <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
          {sessionTimeLabel(session.starts_at)}
        </Text>
        {highlighted ? (
          <Text style={[t.type.caption, { color: t.colors.accent, marginTop: 2 }]}>
            Shared with you
          </Text>
        ) : null}
        <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
          {session.going_count} going  ·  planned by{" "}
          {mine ? (
            "you"
          ) : (
            <Text
              style={{ fontFamily: t.fonts.bodySemi }}
              onPress={() => router.push(`/user/${session.created_by}` as Href)}
            >
              {session.created_by_name}
            </Text>
          )}
        </Text>
        {session.note ? (
          <Text
            style={[t.type.caption, { color: t.colors.textSecondary, fontStyle: "italic", marginTop: 2 }]}
            numberOfLines={2}
          >
            “{session.note}”
          </Text>
        ) : null}
        <ErrorText message={error} />
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={() =>
            void Share.share({
              message: runShareMessage(
                courtName,
                sessionTimeLabel(session.starts_at),
                buildCourtLink(courtId, session.id),
              ),
            }).catch(() => {})
          }
          hitSlop={8}
          style={styles.cancelButton}
        >
          <Ionicons name="share-outline" size={18} color={t.colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => {
            if (!user) return detour();
            setError(null);
            rsvp.mutate(
              { sessionId: session.id, status: going ? "out" : "going" },
              { onError: (e) => setError(e.message) },
            );
          }}
          disabled={rsvp.isPending}
          style={[
            styles.rsvpButton,
            {
              borderRadius: t.radius.full,
              borderColor: going ? t.colors.accent : t.colors.border,
              backgroundColor: going ? t.colors.accent : t.colors.surface,
            },
          ]}
        >
          <Text
            style={[
              t.type.label,
              { color: going ? t.colors.onAccent : t.colors.textSecondary },
            ]}
          >
            {going ? "Going" : "I'm in"}
          </Text>
        </Pressable>
        {mine && (
          <Pressable
            onPress={() =>
              cancel.mutate(session.id, { onError: (e) => setError(e.message) })
            }
            disabled={cancel.isPending}
            hitSlop={8}
            style={styles.cancelButton}
          >
            <Ionicons name="trash-outline" size={18} color={t.colors.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function CourtSessions({
  courtId,
  courtName,
  highlightId,
}: {
  courtId: string;
  courtName: string;
  highlightId?: string | null;
}) {
  const t = useTheme();
  const router = useRouter();
  const { data: sessions } = useCourtSessions(courtId);

  return (
    <Card>
      <View style={styles.header}>
        <Overline>Upcoming runs</Overline>
        <Pressable onPress={() => router.push(`/court/${courtId}/plan`)} hitSlop={10}>
          <Ionicons name="add-circle-outline" size={22} color={t.colors.accent} />
        </Pressable>
      </View>
      {(sessions?.length ?? 0) > 0 ? (
        (() => {
          const ordered = [...(sessions ?? [])].sort((a, b) =>
            a.id === highlightId ? -1 : b.id === highlightId ? 1 : 0,
          );
          return ordered.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              courtId={courtId}
              courtName={courtName}
              highlighted={s.id === highlightId}
            />
          ));
        })()
      ) : (
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          Nothing planned. Set a time and get a run going.
        </Text>
      )}
      <Button
        title="Plan a run"
        variant="ghost"
        onPress={() => router.push(`/court/${courtId}/plan`)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1 },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  rsvpButton: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  cancelButton: { padding: 2 },
});
