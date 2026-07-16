import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Chip, ErrorText, Field } from "@/components/ui";
import { QueryError } from "@/components/QueryError";
import { useCreateReport } from "@/lib/hooks";
import { parseRouteId } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { RunQuality } from "@/lib/types";

const qualities: Array<{ value: RunQuality; label: string }> = [
  { value: "empty", label: "Empty" },
  { value: "casual", label: "Casual" },
  { value: "good_run", label: "Good run" },
  { value: "packed", label: "Packed" },
];

export default function ReportScreen() {
  const params = useLocalSearchParams();
  const id = parseRouteId(params.id);
  if (!id) {
    return (
      <QueryError
        error={new Error("Invalid court id")}
        title="Invalid court link"
        message="This court link is not valid."
      />
    );
  }
  return (
    <AuthGate>
      <ReportContent id={id} />
    </AuthGate>
  );
}

function ReportContent({ id }: { id: string }) {
  const router = useRouter();
  const t = useTheme();
  const createReport = useCreateReport(id);
  const [quality, setQuality] = useState<RunQuality | null>(null);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const playerCount = count.trim() === "" ? undefined : Number(count);
    if (playerCount !== undefined && (!Number.isInteger(playerCount) || playerCount < 0)) {
      setError("Player count must be a whole number");
      return;
    }
    if (!quality && playerCount === undefined && !note.trim()) {
      setError("Tell us something — how busy is it?");
      return;
    }
    createReport.mutate(
      {
        run_quality: quality ?? undefined,
        player_count: playerCount,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => router.back(),
        onError: (e) => setError(e.message),
      },
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
        <Text
          style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}
        >
          How's the run?
        </Text>
        <View style={styles.chips}>
          {qualities.map((q) => (
            <Chip
              key={q.value}
              label={q.label}
              selected={quality === q.value}
              onPress={() => setQuality(quality === q.value ? null : q.value)}
            />
          ))}
        </View>
        <Field
          label="About how many people are playing?"
          value={count}
          onChangeText={setCount}
          keyboardType="number-pad"
          placeholder="e.g. 8"
        />
        <Field
          label="Anything else? (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Winners stay, decent competition"
          maxLength={280}
        />
        <ErrorText message={error} />
        <Button title="Post report" onPress={submit} busy={createReport.isPending} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
});
