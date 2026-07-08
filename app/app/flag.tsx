import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, ErrorText, Field } from "@/components/ui";
import { useCreateFlag } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { FlagEntityType } from "@/lib/types";

const entityLabels: Record<FlagEntityType, string> = {
  court: "court",
  photo: "photo",
  report: "crowd report",
};

export default function FlagScreen() {
  const { entityType, entityId } = useLocalSearchParams<{
    entityType: FlagEntityType;
    entityId: string;
  }>();
  const router = useRouter();
  const t = useTheme();
  const createFlag = useCreateFlag();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Tell us what's wrong.");
      return;
    }
    createFlag.mutate(
      { entity_type: entityType, entity_id: entityId, reason: trimmed },
      {
        onSuccess: () => router.back(),
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
        <Text style={[t.type.body, { color: t.colors.textSecondary }]}>
          Report this {entityLabels[entityType] ?? "item"} to moderators. What's the issue?
        </Text>
        <Field
          label="Reason"
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Wrong location, offensive photo, spam"
          multiline
          numberOfLines={4}
        />
        <ErrorText message={error} />
        <Button title="Submit report" busy={createFlag.isPending} onPress={submit} />
      </ScrollView>
    </AuthGate>
  );
}
