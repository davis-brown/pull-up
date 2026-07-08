import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Card, ErrorText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCourtMessages, useSendMessage, useSetBlocked } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";

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
  const { data: messages } = useCourtMessages(courtId);
  const send = useSendMessage(courtId);
  const setBlocked = useSetBlocked();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which message's report/block actions are expanded (tap the header row).
  const [actionsFor, setActionsFor] = useState<string | null>(null);

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
      <Text style={[t.type.label, { color: t.colors.textSecondary }]}>Court talk</Text>
      {(messages?.length ?? 0) > 0 ? (
        <View style={{ marginTop: t.spacing.sm }}>
          {messages!.map((m) => {
            const mine = m.user_id === user?.id;
            return (
              <View key={m.id} style={styles.message}>
                <Pressable
                  onPress={() => !mine && setActionsFor(actionsFor === m.id ? null : m.id)}
                  disabled={mine}
                >
                  <Text style={[t.type.caption, { color: t.colors.textMuted }]}>
                    <Text style={{ fontWeight: "600", color: mine ? t.colors.accent : t.colors.textSecondary }}>
                      {mine ? "You" : m.display_name}
                    </Text>
                    {"  ·  "}
                    {messageTimeLabel(m.created_at)}
                  </Text>
                </Pressable>
                <Text style={[t.type.body, { color: t.colors.textPrimary, marginTop: 1 }]}>
                  {m.body}
                </Text>
                {actionsFor === m.id && !mine && (
                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={() => {
                        setActionsFor(null);
                        router.push(`/flag?entityType=message&entityId=${m.id}`);
                      }}
                      hitSlop={6}
                    >
                      <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>Report</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setActionsFor(null);
                        setBlocked.mutate(
                          { userId: m.user_id, blocked: true },
                          { onError: (e) => setError(e.message) },
                        );
                      }}
                      hitSlop={6}
                    >
                      <Text style={[t.type.caption, { color: t.colors.danger }]}>
                        Block {m.display_name}
                      </Text>
                    </Pressable>
                  </View>
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
      <ErrorText message={error} />
    </Card>
  );
}

const styles = StyleSheet.create({
  message: { paddingVertical: 5 },
  actionsRow: { flexDirection: "row", gap: 18, marginTop: 4 },
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
