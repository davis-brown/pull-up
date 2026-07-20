import { useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSignInDetour } from "@/components/SignInCta";
import { Button, Card, Chip, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useRunIntents, useSetRunIntent } from "@/lib/hooks";
import { SKILL_LEVELS } from "@/lib/player";
import {
  dayOffsetFromToday,
  groupRunIntents,
  intentDayOptions,
  windowsForDate,
  type RunIntentBucket,
} from "@/lib/run-intents";
import { safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import { WINDOW_SPANS } from "@/lib/your-window";

function skillLabel(key: string | null): string | null {
  if (!key) return null;
  return SKILL_LEVELS.find((s) => s.key === key)?.label ?? null;
}

function BucketRow({
  bucket,
  courtId,
  mine,
}: {
  bucket: RunIntentBucket;
  courtId: string;
  mine: boolean;
}) {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const detour = useSignInDetour();
  const setIntent = useSetRunIntent(courtId);

  const names = bucket.seekers.map((s) => {
    const skill = skillLabel(s.skill_level);
    return skill ? `${s.display_name} (${skill})` : s.display_name;
  });

  return (
    <View style={[styles.row, { borderTopColor: t.colors.border }]}>
      <View style={styles.rowBody}>
        <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
          {bucket.seekers.length} looking to play {bucket.label}
        </Text>
        <Text
          style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}
          numberOfLines={2}
        >
          {names.join(", ")}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={() => {
            const now = new Date();
            const dayOffset = dayOffsetFromToday(bucket.run_date, now);
            // A starting-point hour from the window's span — plan.tsx
            // silently drops it if it's already past for "today".
            const span = WINDOW_SPANS.find((w) => w.key === bucket.window_key);
            const hourParam = span ? `&prefillHour=${span.start}` : "";
            router.push(`/court/${safePathSegment(courtId)}/plan?prefillDay=${dayOffset}${hourParam}` as Href);
          }}
          hitSlop={8}
        >
          <Text style={[t.type.label, { color: t.colors.accent }]}>Plan it</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!user) return detour();
            setIntent.mutate({ joined: !mine, run_date: bucket.run_date, window_key: bucket.window_key });
          }}
          disabled={setIntent.isPending}
          style={[
            styles.toggleButton,
            {
              borderRadius: t.radius.full,
              borderColor: mine ? t.colors.accent : t.colors.border,
              backgroundColor: mine ? t.colors.accent : t.colors.surface,
            },
          ]}
        >
          <Text style={[t.type.label, { color: mine ? t.colors.onAccent : t.colors.textSecondary }]}>
            {mine ? "You're in" : "I'm in"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Court page section for phase 19's "looking for a run": public demand
// signal ("3 players want to run Thursday evening") plus a picker to mark
// or withdraw your own intent. Distinct from CourtSessions — that's
// concrete planned runs; this is symbolic, pre-plan demand that a planned
// run (or the threshold push) converts into one.
export function LookingToPlay({ courtId }: { courtId: string }) {
  const t = useTheme();
  const { user } = useAuth();
  const detour = useSignInDetour();
  const { data: seekers, error } = useRunIntents(courtId);
  const setIntent = useSetRunIntent(courtId);
  const [picking, setPicking] = useState(false);
  const [pickedDay, setPickedDay] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const buckets = useMemo(() => groupRunIntents(seekers ?? [], now), [seekers, now]);
  const dayOptions = useMemo(() => intentDayOptions(now), [now]);
  const windowOptions = pickedDay ? windowsForDate(pickedDay) : [];

  const startPicking = () => {
    if (!user) return detour();
    setPickedDay(null);
    setPicking(true);
  };

  const pickWindow = (windowKey: string) => {
    if (!pickedDay) return;
    setIntent.mutate(
      { joined: true, run_date: pickedDay, window_key: windowKey },
      { onSuccess: () => setPicking(false) },
    );
  };

  return (
    <Card>
      <Overline>Looking to play</Overline>
      {buckets.length > 0 ? (
        buckets.map((b) => (
          <BucketRow
            key={`${b.run_date}|${b.window_key}`}
            bucket={b}
            courtId={courtId}
            mine={b.seekers.some((s) => s.user_id === user?.id)}
          />
        ))
      ) : (
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          Nobody's called a time yet — be the first.
        </Text>
      )}
      <ErrorText message={error instanceof Error ? error.message : null} />
      <ErrorText message={setIntent.error instanceof Error ? setIntent.error.message : null} />

      {picking ? (
        <View style={{ marginTop: t.spacing.md }}>
          <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
            Which day?
          </Text>
          <View style={styles.chips}>
            {dayOptions.map((d) => (
              <Chip
                key={d.iso}
                label={d.label}
                selected={pickedDay === d.iso}
                onPress={() => setPickedDay(d.iso)}
              />
            ))}
          </View>
          {pickedDay ? (
            <>
              <Text
                style={[
                  t.type.label,
                  { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.sm },
                ]}
              >
                Which window?
              </Text>
              <View style={styles.chips}>
                {windowOptions.map((w) => (
                  <Chip key={w.key} label={w.label} selected={false} onPress={() => pickWindow(w.key)} />
                ))}
              </View>
            </>
          ) : null}
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => setPicking(false)}
          />
        </View>
      ) : (
        <Button title="I'm looking to play" variant="ghost" onPress={startPicking} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1 },
  rowActions: { alignItems: "flex-end", gap: 8 },
  toggleButton: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: -8 },
});
