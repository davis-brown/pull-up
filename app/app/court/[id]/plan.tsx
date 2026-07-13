import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { sessionTimeLabel } from "@/components/CourtSessions";
import { Button, Chip, ErrorText, Field } from "@/components/ui";
import { useCreateSession } from "@/lib/hooks";
import { buildCourtLink, runShareMessage } from "@/lib/links";
import { useTheme } from "@/lib/theme";

// Quick-pick scheduling: day + hour chips instead of a date-picker dependency.
const hourOptions = [7, 9, 12, 15, 17, 18, 19, 20];

function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric" });
}

export default function PlanSessionScreen() {
  const { id, prefillHour } = useLocalSearchParams<{ id: string; prefillHour?: string }>();
  const router = useRouter();
  const t = useTheme();
  const createSession = useCreateSession(id ?? "");
  // The map sheet's I'M IN passes the scrubbed hour as ?prefillHour — preset
  // the time picker with it when it's still a valid hour later today.
  const prefill = useMemo(() => {
    const n = Number(prefillHour);
    return Number.isInteger(n) && n > new Date().getHours() && n <= 23 ? n : null;
  }, [prefillHour]);
  const [dayOffset, setDayOffset] = useState(0);
  const [hour, setHour] = useState<number | null>(prefill);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const dayOptions = useMemo(() => {
    const out: Array<{ offset: number; label: string }> = [];
    for (let offset = 0; offset < 7; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      out.push({
        offset,
        label:
          offset === 0
            ? "Today"
            : offset === 1
              ? "Tomorrow"
              : d.toLocaleDateString([], { weekday: "short", day: "numeric" }),
      });
    }
    return out;
  }, []);

  // A prefilled hour that isn't one of the quick picks gets its own chip.
  const hourChoices =
    prefill != null && !hourOptions.includes(prefill)
      ? [...hourOptions, prefill].sort((a, b) => a - b)
      : hourOptions;

  // Hours already in the past drop off for "Today".
  const availableHours = hourChoices.filter(
    (h) => dayOffset > 0 || h > new Date().getHours(),
  );

  const submit = () => {
    setError(null);
    if (hour == null) {
      setError("Pick a time");
      return;
    }
    const starts = new Date();
    starts.setDate(starts.getDate() + dayOffset);
    starts.setHours(hour, 0, 0, 0);
    createSession.mutate(
      { starts_at: starts.toISOString(), note: note.trim() || undefined },
      {
        onSuccess: (session) => {
          void Share.share({
            message: runShareMessage(
              "this court",
              sessionTimeLabel(session.starts_at),
              buildCourtLink(id ?? "", session.id),
            ),
          })
            .catch(() => {})
            .finally(() => router.back());
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <AuthGate>
      <ScrollView
        style={{ backgroundColor: t.colors.background }}
        contentContainerStyle={{ padding: t.spacing.lg }}
      >
        <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
          Which day?
        </Text>
        <View style={styles.chips}>
          {dayOptions.map((d) => (
            <Chip
              key={d.offset}
              label={d.label}
              selected={dayOffset === d.offset}
              onPress={() => {
                setDayOffset(d.offset);
                setHour(null);
              }}
            />
          ))}
        </View>

        <Text
          style={[
            t.type.label,
            { color: t.colors.textSecondary, marginTop: t.spacing.lg, marginBottom: t.spacing.sm },
          ]}
        >
          What time?
        </Text>
        <View style={styles.chips}>
          {availableHours.map((h) => (
            <Chip key={h} label={hourLabel(h)} selected={hour === h} onPress={() => setHour(h)} />
          ))}
        </View>
        {availableHours.length === 0 && (
          <Text style={[t.type.caption, { color: t.colors.textMuted }]}>
            Too late for today — pick another day.
          </Text>
        )}

        <Field
          label="Note (optional)"
          placeholder="Bring a ball, running 5s…"
          value={note}
          onChangeText={setNote}
          maxLength={280}
        />

        <ErrorText message={error} />
        <View style={{ marginTop: t.spacing.sm }}>
          <Button title="Plan it" busy={createSession.isPending} onPress={submit} />
          <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: -8 },
});
