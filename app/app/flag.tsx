import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, ErrorText, Field } from "@/components/ui";
import { QueryError } from "@/components/QueryError";
import { useCreateFlag } from "@/lib/hooks";
import { parseRouteId, safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { FlagEntityType } from "@/lib/types";

const entityLabels: Record<FlagEntityType, string> = {
  court: "court",
  photo: "photo",
  report: "crowd report",
  message: "message",
  session: "planned run",
  user: "player",
  feedback: "feedback",
};

function parseEntityType(value: unknown): FlagEntityType | undefined {
  return typeof value === "string" && value in entityLabels
    ? value as FlagEntityType
    : undefined;
}

export default function FlagScreen() {
  const params = useLocalSearchParams();
  const entityType = parseEntityType(params.entityType);
  const entityId = parseRouteId(params.entityId);
  if (!entityType || !entityId) {
    return (
      <QueryError
        error={new Error("Invalid report target")}
        title="Invalid report link"
        message="Open the item you want to report and try again."
      />
    );
  }
  const next = `/flag?entityType=${entityType}&entityId=${safePathSegment(entityId)}`;
  return (
    <AuthGate next={next}>
      <FlagContent entityType={entityType} entityId={entityId} />
    </AuthGate>
  );
}

function FlagContent({
  entityType,
  entityId,
}: {
  entityType: FlagEntityType;
  entityId: string;
}) {
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

  const isFeedback = entityType === "feedback";
  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
        <Text style={[t.type.body, { color: t.colors.textSecondary }]}>
          {isFeedback
            ? "Found a bug or have an idea? This goes straight to the developer."
            : `Report this ${entityLabels[entityType] ?? "item"} to moderators. What's the issue?`}
        </Text>
        <Field
          label={isFeedback ? "Your feedback" : "Reason"}
          value={reason}
          onChangeText={setReason}
          placeholder={
            isFeedback
              ? "e.g. The map jumps when I check in / It'd be great if…"
              : "e.g. Wrong location, offensive photo, spam"
          }
          multiline
          numberOfLines={4}
        />
        <ErrorText message={error} />
        <Button
          title={isFeedback ? "Send feedback" : "Submit report"}
          busy={createFlag.isPending}
          onPress={submit}
        />
    </ScrollView>
  );
}
