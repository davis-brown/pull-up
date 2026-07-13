import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, Chip, Overline } from "@/components/ui";
import {
  activePreset,
  matchesFilters,
  PRESETS,
  type CourtFilters,
  type Surface,
} from "@/lib/court-filters";
import { useTheme } from "@/lib/theme";
import type { CourtSummary } from "@/lib/types";

const BOOL_TOGGLES: Array<{ key: keyof CourtFilters; label: string }> = [
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

const SURFACES: Array<{ value: Surface; label: string }> = [
  { value: "concrete", label: "Concrete" },
  { value: "asphalt", label: "Asphalt" },
  { value: "hardwood", label: "Hardwood" },
];

// Modal filter sheet: quick presets (canned filter bundles) plus individual
// chips for fine-tuning. Presets just set the draft wholesale — chips stay
// editable afterward, and editing them off a preset's exact bundle clears
// its highlight (see `activePreset`). The count on the CTA is computed
// client-side over the already-loaded viewport courts against the DRAFT
// state; Apply commits the draft to the real filters (triggering the
// server-filtered refetch) and closes.
export function FilterSheet({
  visible,
  filters,
  courts,
  onApply,
  onClose,
}: {
  visible: boolean;
  filters: CourtFilters;
  courts: CourtSummary[];
  onApply: (f: CourtFilters) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<CourtFilters>(filters);

  // Re-seed the draft from the committed filters every time the sheet opens
  // so a stale in-progress edit from a previous open (dismissed without
  // Apply) never leaks into the next one.
  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  const preset = activePreset(draft);
  const count = courts.filter((c) => matchesFilters(c, draft)).length;

  const toggle = (key: keyof CourtFilters) => {
    setDraft((d) => ({ ...d, [key]: d[key] ? undefined : true }));
  };

  const setMinHoops = (value: 2 | 4) => {
    setDraft((d) => ({
      ...d,
      min_hoops: d.min_hoops === value ? undefined : value,
    }));
  };

  const setSurface = (value: Surface) => {
    setDraft((d) => ({
      ...d,
      surface: d.surface === value ? undefined : value,
    }));
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={[styles.overlay, { backgroundColor: t.colors.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close filters"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: t.colors.surface,
              borderTopLeftRadius: t.radius.xl,
              borderTopRightRadius: t.radius.xl,
            },
            t.shadows.sheet,
          ]}
        >
          <ScrollView contentContainerStyle={{ padding: t.spacing.lg }}>
            <View style={styles.header}>
              <Text style={[t.type.display, { color: t.colors.textPrimary }]}>
                Filters
              </Text>
              <Pressable onPress={() => setDraft({})} hitSlop={8}>
                <Text style={[t.type.bodyMedium, { color: t.colors.accent }]}>
                  Reset
                </Text>
              </Pressable>
            </View>

            <Overline
              style={{ marginTop: t.spacing.lg, marginBottom: t.spacing.sm }}
            >
              Quick presets
            </Overline>
            <View style={styles.presetGrid}>
              {PRESETS.map((p) => {
                const selected = preset === p.key;
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => setDraft(p.filters)}
                    style={[
                      styles.presetCard,
                      {
                        borderRadius: t.radius.lg,
                        borderWidth: selected ? 2 : 1,
                        borderColor: selected
                          ? t.colors.accent
                          : t.colors.border,
                        backgroundColor: selected
                          ? t.colors.accentSurface
                          : t.colors.background,
                      },
                    ]}
                  >
                    <Ionicons
                      name={p.icon as keyof typeof Ionicons.glyphMap}
                      size={20}
                      color={
                        selected
                          ? t.colors.accentPressed
                          : t.colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        t.type.displayCondensed,
                        {
                          fontSize: 18,
                          marginTop: t.spacing.xs,
                          color: selected
                            ? t.colors.accentPressed
                            : t.colors.textPrimary,
                        },
                      ]}
                    >
                      {p.title}
                    </Text>
                    <Text
                      style={[
                        t.type.caption,
                        { color: t.colors.textSecondary, marginTop: 2 },
                      ]}
                    >
                      {p.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Overline
              style={{ marginTop: t.spacing.xl, marginBottom: t.spacing.sm }}
            >
              Fine-tune
            </Overline>
            <View style={styles.chipWrap}>
              {BOOL_TOGGLES.map(({ key, label }) => (
                <Chip
                  key={key}
                  label={label}
                  selected={!!draft[key]}
                  onPress={() => toggle(key)}
                />
              ))}
              <Chip
                label="2+ hoops"
                selected={draft.min_hoops === 2}
                onPress={() => setMinHoops(2)}
              />
              <Chip
                label="4+ hoops"
                selected={draft.min_hoops === 4}
                onPress={() => setMinHoops(4)}
              />
              {SURFACES.map(({ value, label }) => (
                <Chip
                  key={value}
                  label={label}
                  selected={draft.surface === value}
                  onPress={() => setSurface(value)}
                />
              ))}
            </View>
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: t.colors.border }]}>
            <Button
              title={`Show ${count} court${count === 1 ? "" : "s"}`}
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  sheet: { position: "absolute", top: 150, left: 0, right: 0, bottom: 0 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  presetCard: { width: "47%", padding: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap" },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16 },
});
