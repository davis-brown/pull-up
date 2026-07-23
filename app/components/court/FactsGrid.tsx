import { StyleSheet, Text, View } from "react-native";
import { Overline } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import type { CourtDetail } from "@/lib/types";

const DASH = "—";

function surfaceLabel(surface: CourtDetail["surface"]): string {
  if (!surface) return DASH;
  return surface.charAt(0).toUpperCase() + surface.slice(1);
}

// 2×2 grid of a court's core attributes: TYPE / HOOPS / LIGHTS / SURFACE.
// Every cell always renders — unknown values fall back to an em dash so the
// grid keeps its shape. Reused by the desktop panel (Task 14).
export function FactsGrid({ court }: { court: CourtDetail }) {
  const t = useTheme();

  const facts: { label: string; value: string }[] = [
    { label: "Type", value: court.indoor ? "Indoor" : "Outdoor" },
    { label: "Hoops", value: court.hoop_count != null ? String(court.hoop_count) : DASH },
    {
      label: "Lights",
      value: court.lighting == null ? DASH : court.lighting ? "Yes" : "No",
    },
    { label: "Surface", value: surfaceLabel(court.surface) },
  ];

  return (
    <View style={styles.grid}>
      {facts.map((fact) => (
        <View
          key={fact.label}
          style={[
            styles.cell,
            {
              backgroundColor: t.colors.background,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.colors.border,
            },
          ]}
        >
          <Overline>{fact.label}</Overline>
          <Text style={[t.type.heading, styles.value, { color: t.colors.textPrimary }]}>
            {fact.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  cell: {
    // Two per row accounting for the 10px gap.
    flexBasis: "47%",
    flexGrow: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  value: {
    marginTop: 4,
  },
});
