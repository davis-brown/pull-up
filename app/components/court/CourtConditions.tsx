// Player-confirmed court conditions. The selected chip is the court's stored
// value, which follows the recent-confirmation majority server-side.
//
// Core playing facts are always shown; amenity/policy facts appear only when
// the court has a value or a confirmation, with the rest behind "add more
// details" — so the section stays short without hiding known information.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Chip, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { CORE_FACTS, COURT_FACTS, courtFactValue, freshnessLine } from "@/lib/court-facts";
import { useConfirmCourtFact, useCourtFacts } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { CourtDetail } from "@/lib/types";

export function CourtConditions({ court }: { court: CourtDetail }) {
  const t = useTheme();
  const { user } = useAuth();
  const { data: facts } = useCourtFacts(court.id);
  const confirm = useConfirmCourtFact(court.id);
  const byFact = new Map((facts ?? []).map((f) => [f.fact, f]));
  const [expanded, setExpanded] = useState(false);

  const isKnown = (fact: string) =>
    courtFactValue(court, fact) != null || (byFact.get(fact)?.confirmations ?? 0) > 0;

  const alwaysShown = COURT_FACTS.filter((d) => CORE_FACTS.has(d.fact) || isKnown(d.fact));
  const hidden = COURT_FACTS.filter((d) => !CORE_FACTS.has(d.fact) && !isKnown(d.fact));
  const shown = expanded ? [...alwaysShown, ...hidden] : alwaysShown;

  return (
    <View>
      <Text style={[t.type.caption, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
        {user
          ? "Been here? Tap what's true today — the court page stays current when players confirm."
          : "Confirmed by players at the court."}
      </Text>
      {shown.map((def) => {
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
      {hidden.length > 0 ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={
            expanded ? "Show fewer court details" : `Add more court details, ${hidden.length} available`
          }
          hitSlop={8}
          style={styles.moreRow}
        >
          <Text style={[t.type.caption, { color: t.colors.accent }]}>
            {expanded ? "Show less" : `Add more details (${hidden.length})`}
          </Text>
        </Pressable>
      ) : null}
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
  moreRow: {
    paddingVertical: 6,
    marginBottom: 6,
  },
});
