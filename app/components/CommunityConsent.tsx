import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "expo-router";
import { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { TermsCheckbox } from "./TermsAgreement";
import { Button, ErrorText } from "./ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CONTENT_CONSENT_VERSION } from "@/lib/community";
import { useTheme } from "@/lib/theme";

export function CommunityConsent() {
  const { user } = useAuth();
  return user ? <ConsentForAccount key={user.id} userId={user.id} /> : null;
}

function ConsentForAccount({ userId }: { userId: string }) {
  const t = useTheme();
  const path = usePathname();
  const { signOut } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const qc = useQueryClient();
  const queryKey = ["me", userId, "content-consent"];
  const status = useQuery({
    queryKey,
    queryFn: () => api<{ accepted: boolean }>("/me/content-consent"),
  });
  const consent = useMutation({
    mutationFn: () => api<{ accepted: boolean }>("/me/content-consent", {
      method: "POST", body: JSON.stringify({ version: CONTENT_CONSENT_VERSION }),
    }),
    onSuccess: (result) => qc.setQueryData(queryKey, result),
  });
  // Keep legal documents and account deletion accessible without consent.
  const readingOrDeleting = ["/privacy", "/terms", "/support", "/profile-settings"].includes(path);
  const visible = !readingOrDeleting && (status.data?.accepted === false || status.isError);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => void signOut()}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: t.spacing.lg, backgroundColor: t.colors.background }}>
        <View style={{ maxWidth: 640, width: "100%", alignSelf: "center" }}>
          <Text style={[t.type.heading, { color: t.colors.textPrimary, marginBottom: t.spacing.md }]}>Review our community terms</Text>
          <Text style={[t.type.body, { color: t.colors.textSecondary, marginBottom: t.spacing.md }]}>Please review how public posts are checked for safety before posting. You can keep browsing courts without an account.</Text>
          <TermsCheckbox accepted={accepted} onChange={setAccepted} />
          <ErrorText message={consent.error?.message ?? status.error?.message ?? null} />
          <Button title="Agree and continue" disabled={!accepted} busy={consent.isPending} onPress={() => consent.mutate()} />
          <Button title="Sign out and browse courts" variant="ghost" onPress={() => void signOut()} />
        </View>
      </ScrollView>
    </Modal>
  );
}
