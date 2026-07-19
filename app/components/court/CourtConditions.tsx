// Player-confirmed court conditions: each fact shows tap-to-confirm value
// chips and a freshness line. The selected chip is the court's stored value,
// which follows the recent-confirmation majority server-side.
import { StyleSheet, Text, View } from "react-native";
import { Chip, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { COURT_FACTS, courtFactValue, freshnessLine } from "@/lib/court-facts";
import { useConfirmCourtFact, useCourtFacts } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { CourtDetail } from "@/lib/types";

export function CourtConditions({ court }: { court: CourtDetail }) {
  const t = useTheme();
  const { user } = useAuth();
  const { data: facts } = useCourtFacts(court.id);
  const confirm = useConfirmCourtFact(court.id);
  const byFact = new Map((facts ?? []).map((f) => [f.fact, f]));

  return (
    <View>
      <Text style={[t.type.caption, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
        {user
          ? "Been here? Tap what's true today — the court page stays current when players confirm."
          : "Confirmed by players at the court."}
      </Text>
      {COURT_FACTS.map((def) => {
        const current = courtFactValue(court, def.fact);
        const fresh = freshnessLine(byFact.get(def.fact));
        return (
          <View key={def.fact} style={styles.factRow}>
            <Overline style={{ marginBottom: t.spacing.xs }}>{def.label}</Overline>
            <View style={styles.chips}>
              {def.values.map((v) => (
                <Chip
                  key={v.key}
                  label={v.label}
                  selected={current === v.key}
                  onPress={() => {
                    if (!user || confirm.isPending) return;
                    confirm.mutate({ fact: def.fact, value: v.key });
                  }}
                />
              ))}
            </View>
            {fresh ? (
              <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: 2 }]}>
                {fresh}
              </Text>
            ) : null}
          </View>
        );
      })}
      <ErrorText message={confirm.error instanceof Error ? confirm.error.message : null} />
    </View>
  );
}

const styles = StyleSheet.create({
  factRow: {
    marginBottom: 12,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: -8,
  },
});
