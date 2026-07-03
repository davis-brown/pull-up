import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Chip, ErrorText, Field } from "@/components/ui";
import { useCreateReport } from "@/lib/hooks";
import type { RunQuality } from "@/lib/types";

const qualities: Array<{ value: RunQuality; label: string }> = [
  { value: "empty", label: "Empty" },
  { value: "casual", label: "Casual" },
  { value: "good_run", label: "Good run" },
  { value: "packed", label: "Packed" },
];

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const createReport = useCreateReport(id ?? "");
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
    <AuthGate>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.label}>How's the run?</Text>
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
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 8, color: "#555" },
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
});
