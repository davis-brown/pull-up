import { ScrollView, StyleSheet } from "react-native";
import { Chip } from "@/components/ui";
import { useTheme } from "@/lib/theme";
import type { CourtFilters } from "@/lib/court-filters";

const TOGGLES: Array<{ key: keyof CourtFilters; label: string }> = [
  { key: "lit", label: "Lights" },
  { key: "indoor", label: "Indoor" },
  { key: "has_hoops", label: "Hoops" },
  { key: "public", label: "Public" },
  { key: "free", label: "Free" },
  { key: "covered", label: "Covered" },
  { key: "water", label: "Water" },
  { key: "toilets", label: "Restroom" },
  { key: "parking", label: "Parking" },
  { key: "fenced", label: "Fenced" },
];

export function CourtFilterBar({ value, onChange }: { value: CourtFilters; onChange: (f: CourtFilters) => void }) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm, gap: 0 }}
      style={{ backgroundColor: t.colors.background }}
    >
      {TOGGLES.map(({ key, label }) => (
        <Chip
          key={key}
          label={label}
          selected={!!value[key]}
          onPress={() => onChange({ ...value, [key]: value[key] ? undefined : true })}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({});
