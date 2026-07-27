import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button, ErrorText, Overline } from "@/components/ui";
import { useDiscoverySearch } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { AreaSearchHit, CourtSearchHit } from "@/lib/types";

export function DiscoverySearchButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search courts or areas"
      onPress={onPress}
      style={({ pressed }) => [
        styles.searchButton,
        t.shadows.chrome,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderRadius: t.radius.full,
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <Ionicons name="search" size={18} color={t.colors.textSecondary} />
      <Text style={[t.type.bodyMedium, { color: t.colors.textSecondary }]} numberOfLines={1}>
        Search courts or areas
      </Text>
    </Pressable>
  );
}

export function DiscoverySearchSheet({
  visible,
  bias,
  onCourt,
  onArea,
  onClose,
}: {
  visible: boolean;
  bias: { lat: number; lng: number };
  onCourt: (court: CourtSearchHit) => void;
  onArea: (area: AreaSearchHit) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const result = useDiscoverySearch(submitted, bias, visible);

  const submit = () => {
    const query = draft.trim();
    if (query.length < 2 || result.isFetching) return;
    if (query === submitted) {
      void result.refetch();
    } else {
      setSubmitted(query);
    }
  };
  const dismiss = () => {
    setDraft("");
    setSubmitted("");
    onClose();
  };
  const selectCourt = (court: CourtSearchHit) => {
    setDraft("");
    setSubmitted("");
    onCourt(court);
  };
  const selectArea = (area: AreaSearchHit) => {
    setDraft("");
    setSubmitted("");
    onArea(area);
  };
  const empty = result.data && result.data.courts.length === 0 && result.data.areas.length === 0;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={dismiss}>
      <View style={[styles.overlay, { backgroundColor: t.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close search" />
        <View
          style={[
            styles.sheet,
            t.shadows.sheet,
            { backgroundColor: t.colors.surface, borderRadius: t.radius.xl },
          ]}
        >
          <View style={styles.headingRow}>
            <View>
              <Overline>Find a run</Overline>
              <Text style={[t.type.displayCondensed, { color: t.colors.textPrimary }]}>Search anywhere</Text>
            </View>
            <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Close search">
              <Ionicons name="close" size={24} color={t.colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submit}
              returnKeyType="search"
              placeholder="Court, neighborhood, or city"
              placeholderTextColor={t.colors.textMuted}
              style={[
                styles.input,
                t.type.body,
                { color: t.colors.textPrimary, borderColor: t.colors.border, backgroundColor: t.colors.background },
              ]}
            />
            <Button title="Search" onPress={submit} disabled={draft.trim().length < 2 || result.isFetching} />
          </View>
          <ErrorText message={result.error instanceof Error ? result.error.message : null} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
            {result.isFetching && <ActivityIndicator color={t.colors.accent} style={styles.loading} />}
            {(result.data?.courts.length ?? 0) > 0 && <Overline style={styles.sectionLabel}>Courts</Overline>}
            {result.data?.courts.map((court) => (
              <ResultRow
                key={court.id}
                icon="basketball-outline"
                title={court.name}
                subtitle={court.address ?? (court.distance_m != null ? `${Math.round(court.distance_m / 100) / 10} km away` : "Court")}
                onPress={() => selectCourt(court)}
              />
            ))}
            {(result.data?.areas.length ?? 0) > 0 && <Overline style={styles.sectionLabel}>Areas</Overline>}
            {result.data?.areas.map((area) => (
              <ResultRow
                key={`${area.name}-${area.lat}-${area.lng}`}
                icon="location-outline"
                title={area.name}
                subtitle={area.type || "Area"}
                onPress={() => selectArea(area)}
              />
            ))}
            {result.data?.area_search_unavailable && (
              <Text style={[t.type.caption, styles.notice, { color: t.colors.textMuted }]}>Area search is temporarily unavailable. Court results are still shown.</Text>
            )}
            {empty && (
              <Text style={[t.type.body, styles.empty, { color: t.colors.textSecondary }]}>No matching courts or areas.</Text>
            )}
          </ScrollView>
          <Text style={[t.type.caption, styles.attribution, { color: t.colors.textMuted }]}>Area results © OpenStreetMap contributors</Text>
        </View>
      </View>
    </Modal>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: "basketball-outline" | "location-outline";
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.resultRow, { borderBottomColor: t.colors.border, backgroundColor: pressed ? t.colors.background : "transparent" }]}
    >
      <View style={[styles.resultIcon, { backgroundColor: t.colors.accentSurface, borderRadius: t.radius.full }]}>
        <Ionicons name={icon} size={18} color={t.colors.accent} />
      </View>
      <View style={styles.resultCopy}>
        <Text style={[t.type.heading, { color: t.colors.textPrimary }]} numberOfLines={1}>{title}</Text>
        <Text style={[t.type.caption, { color: t.colors.textSecondary, textTransform: "capitalize" }]} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchButton: {
    width: 260,
    height: 42,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  sheet: { width: "100%", maxWidth: 560, maxHeight: "78%", paddingTop: 22, overflow: "hidden" },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 22 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 22, marginTop: 18 },
  input: { flex: 1, minWidth: 0, height: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 14 },
  results: { paddingHorizontal: 22, paddingBottom: 12 },
  loading: { marginTop: 28 },
  sectionLabel: { marginTop: 22, marginBottom: 4 },
  resultRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  resultIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  resultCopy: { flex: 1 },
  notice: { marginTop: 18 },
  empty: { textAlign: "center", paddingVertical: 36 },
  attribution: { textAlign: "center", paddingHorizontal: 22, paddingBottom: 16, paddingTop: 8 },
});
