import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SignInAction, useSignInDetour } from "@/components/SignInCta";
import { QueryError } from "@/components/QueryError";
import { Card, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCourtMessages, useSendMessage, useSetBlocked } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import { safePathSegment } from "@/lib/routes";

function messageTimeLabel(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export function CourtChat({ courtId }: { courtId: string }) {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const { data: messages, error: queryError, refetch } = useCourtMessages(courtId);
  const send = useSendMessage(courtId);
  const setBlocked = useSetBlocked();
  const detour = useSignInDetour();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which message's report/block actions are expanded (the "…" button), and
  // whether its block is awaiting confirmation.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [confirmingBlock, setConfirmingBlock] = useState(false);

  const toggleActions = (id: string) => {
    setConfirmingBlock(false);
    setActionsFor(actionsFor === id ? null : id);
  };

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setError(null);
    send.mutate(body, {
      onSuccess: () => setDraft(""),
      onError: (e) => setError(e.message),
    });
  };

  return (
    <Card>
      <Overline>Court talk</Overline>
      {queryError && !messages ? (
        <QueryError error={queryError} onRetry={() => void refetch()} />
      ) : (messages?.length ?? 0) > 0 ? (
        <View style={{ marginTop: t.spacing.sm }}>
          {messages!.map((m) => {
            const mine = m.user_id === user?.id;
            return (
              <View key={m.id} style={styles.message}>
                <View style={styles.headerRow}>
                  <Pressable onPress={() => router.push(`/user/${safePathSegment(m.user_id)}` as Href)} hitSlop={4}>
                    <Text
                      style={[
                        t.type.caption,
                        {
                          fontFamily: t.fonts.bodySemi,
                          color: mine ? t.colors.accent : t.colors.textSecondary,
                        },
                      ]}
                    >
                      {mine ? "You" : m.display_name}
                    </Text>
                  </Pressable>
                  <Text style={[t.type.caption, styles.time, { color: t.colors.textMuted }]}>
                    {"  ·  "}
                    {messageTimeLabel(m.created_at)}
                  </Text>
                  {!mine && (
                    <Pressable
                      onPress={() => toggleActions(m.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Report or block ${m.display_name}`}
                    >
                      <Ionicons name="ellipsis-horizontal" size={16} color={t.colors.textMuted} />
                    </Pressable>
                  )}
                </View>
                <Text style={[t.type.body, { color: t.colors.textPrimary, marginTop: 1 }]}>
                  {m.body}
                </Text>
                {actionsFor === m.id && !mine && (
                  confirmingBlock ? (
                    <View style={styles.actionsRow}>
                      <Text style={[t.type.caption, styles.confirmText, { color: t.colors.textSecondary }]}>
                        Block {m.display_name}? You won&apos;t see their messages.
                      </Text>
                      <Pressable
                        onPress={() => {
                          setActionsFor(null);
                          setConfirmingBlock(false);
                          setBlocked.mutate(
                            { userId: m.user_id, blocked: true },
                            { onError: (e) => setError(e.message) },
                          );
                        }}
                        hitSlop={6}
                        accessibilityRole="button"
                      >
                        <Text style={[t.type.caption, { color: t.colors.danger }]}>Block</Text>
                      </Pressable>
                      <Pressable onPress={() => setConfirmingBlock(false)} hitSlop={6} accessibilityRole="button">
                        <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Cancel</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <View style={styles.actionsRow}>
                      <Pressable
                        onPress={() => {
                          setActionsFor(null);
                          router.push(`/flag?entityType=message&entityId=${safePathSegment(m.id)}`);
                        }}
                        hitSlop={6}
                        accessibilityRole="button"
                      >
                        <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Report message</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => (user ? setConfirmingBlock(true) : detour())}
                        hitSlop={6}
                        accessibilityRole="button"
                      >
                        <Text style={[t.type.caption, { color: t.colors.danger }]}>
                          Block {m.display_name}
                        </Text>
                      </Pressable>
                    </View>
                  )
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          No messages yet. Ask who's running today.
        </Text>
      )}
      {user ? (
        <View style={[styles.inputRow, { marginTop: t.spacing.sm }]}>
          <TextInput
            style={[
              t.type.body,
              styles.input,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.full,
                backgroundColor: t.colors.surface,
                color: t.colors.textPrimary,
              },
            ]}
            placeholder="Message this court…"
            placeholderTextColor={t.colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            maxLength={500}
            multiline
            onSubmitEditing={submit}
          />
          <Pressable
            onPress={submit}
            disabled={send.isPending || !draft.trim()}
            hitSlop={8}
            style={styles.sendButton}
          >
            {send.isPending ? (
              <ActivityIndicator size="small" color={t.colors.accent} />
            ) : (
              <Ionicons
                name="arrow-up-circle"
                size={30}
                color={draft.trim() ? t.colors.accent : t.colors.textMuted}
              />
            )}
          </Pressable>
        </View>
      ) : (
        <View style={{ marginTop: t.spacing.sm }}>
          <SignInAction label="Sign in to chat" />
        </View>
      )}
      <ErrorText message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  message: { paddingVertical: 5 },
  headerRow: { flexDirection: "row", alignItems: "center" },
  time: { flex: 1 },
  actionsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 18, marginTop: 4 },
  confirmText: { flexBasis: "100%" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 90,
  },
  sendButton: { paddingBottom: 2 },
});
