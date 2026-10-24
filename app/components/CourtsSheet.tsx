import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { CourtList } from "@/components/DesktopPanel";
import { DiscoveryResults } from "@/components/DiscoverySearch";
import { FilterPanel } from "@/components/FilterSheet";
import type { CourtFilters } from "@/lib/court-filters";
import { useDiscoverySearch } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import type { AreaSearchHit, CourtSearchHit, CourtSummary } from "@/lib/types";

// Collapsed height until the header measures itself.
const DEFAULT_PEEK = 86;
// The expanded sheet covers this share of the map.
const EXPANDED_RATIO = 0.78;

type Mode = "list" | "search" | "filter";

// The mobile map's bottom sheet. One sheet holds the court
// list, search results, and filters: the search field and filter button in
// its header switch what the body shows. Drag the header or tap the grabber
// to open or close it; pulling the list down from its top also closes it.
export function CourtsSheet({
  courts,
  filters,
  activeFilterCount,
  bias,
  onApplyFilters,
  onSelect,
  onSearchCourt,
  onSearchArea,
  onAddCourt,
}: {
  courts: CourtSummary[];
  filters: CourtFilters;
  activeFilterCount: number;
  bias: { lat: number; lng: number };
  onApplyFilters: (f: CourtFilters) => void;
  onSelect: (id: string) => void;
  onSearchCourt: (court: CourtSearchHit) => void;
  onSearchArea: (area: AreaSearchHit) => void;
  onAddCourt: () => void;
}) {
  const t = useTheme();
  const [areaHeight, setAreaHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>("list");
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [focused, setFocused] = useState(false);
  const result = useDiscoverySearch(submitted, bias, mode === "search");
  // translateY of the sheet: 0 is fully expanded, `travel` is collapsed.
  const [y] = useState(() => new Animated.Value(10000));
  // The list's scroll offset, read by the pull-down-to-collapse gesture.
  const [listScroll] = useState(() => {
    let top = 0;
    return { set: (v: number) => (top = v), atTop: () => top <= 0 };
  });
  // The collapsed sheet shows exactly the header (grabber + search row), so
  // no sliver of the list peeks out above the tab bar.
  const [peek, setPeek] = useState(DEFAULT_PEEK);
  const input = useRef<TextInput>(null);
  const sheetHeight = Math.max(areaHeight * EXPANDED_RATIO, peek);
  const travel = sheetHeight - peek;

  const snap = (open: boolean) => {
    setExpanded(open);
    if (!open) {
      // Collapsing always returns to the list and clears any search.
      Keyboard.dismiss();
      setMode("list");
      setDraft("");
      setSubmitted("");
    }
    Animated.spring(y, {
      toValue: open ? 0 : travel,
      useNativeDriver: true,
      bounciness: 0,
      speed: 16,
    }).start();
  };
  const open = (next: Mode) => {
    setMode(next);
    if (!expanded) snap(true);
  };

  // Re-seat without animating on first layout, resize, and header changes.
  useEffect(() => {
    if (!expanded) y.setValue(travel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travel]);
  const onLayout = (e: LayoutChangeEvent) => setAreaHeight(e.nativeEvent.layout.height);
  const onHeaderLayout = (e: LayoutChangeEvent) => setPeek(Math.ceil(e.nativeEvent.layout.height));

  // Tapping the collapsed search bar. On web the sheet jumps open before the
  // input takes focus: iOS Safari scrolls the whole page to keep a focused
  // input above the keyboard, and the input must already be at the top, or
  // the page scrolls and the opening sheet carries the field out of view.
  // focus() stays in the tap handler, as iOS only raises the keyboard then.
  const startSearch = () => {
    setMode("search");
    if (Platform.OS === "web") {
      y.stopAnimation();
      y.setValue(0);
      setExpanded(true);
    } else {
      snap(true);
    }
    input.current?.focus();
  };

  // One drag behavior for two regions. The header claims any vertical drag,
  // even one that began on its buttons. The list only gives up a downward
  // drag that starts while it is scrolled to the top.
  const makePan = (header: boolean) => {
    let dragStart = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => header,
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        Math.abs(g.dy) > 6 &&
        Math.abs(g.dy) > Math.abs(g.dx) &&
        (header || (mode === "list" && listScroll.atTop() && g.dy > 0)),
      onPanResponderGrant: () => {
        y.stopAnimation((v) => {
          dragStart = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        y.setValue(Math.min(Math.max(dragStart + g.dy, 0), travel));
      },
      onPanResponderRelease: (_e, g) => {
        // A tap, not a drag: leave it to whatever was tapped (the search field
        // focusing opens the sheet itself).
        if (Math.abs(g.dy) < 4) return;
        const at = dragStart + g.dy;
        snap(g.vy < -0.3 || (g.vy <= 0.3 && at < travel / 2));
      },
      onPanResponderTerminate: () => snap(expanded),
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headerPan = useMemo(() => makePan(true), [travel, expanded, mode]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const listPan = useMemo(() => makePan(false), [travel, expanded, mode]);

  // Search as you type, once the query pauses; Enter skips the wait.
  useEffect(() => {
    const query = draft.trim();
    const id = setTimeout(() => setSubmitted(query.length >= 2 ? query : ""), 300);
    return () => clearTimeout(id);
  }, [draft]);
  const submit = () => {
    const query = draft.trim();
    if (query.length >= 2) setSubmitted(query);
  };
  const select = (id: string | null) => {
    if (id == null) return;
    snap(false);
    onSelect(id);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <Animated.View
        style={[
          styles.sheet,
          t.shadows.sheet,
          {
            height: sheetHeight,
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            transform: [{ translateY: y }],
          },
        ]}
      >
        <View {...headerPan.panHandlers} onLayout={onHeaderLayout} style={styles.header}>
          <Pressable
            onPress={() => snap(!expanded)}
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Collapse courts list" : "Show courts list"}
            style={styles.grabberHit}
          >
            <View style={[styles.grabber, { backgroundColor: t.colors.border }]} />
          </Pressable>
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchField,
                {
                  backgroundColor: t.colors.surfaceMuted,
                  borderRadius: t.radius.md,
                  // The focus ring lives on the whole field, not the bare input.
                  borderColor: focused ? t.colors.accent : "transparent",
                },
              ]}
            >
              <Ionicons name="search" size={18} color={t.colors.textSecondary} />
              <TextInput
                ref={input}
                value={draft}
                onChangeText={setDraft}
                onFocus={() => {
                  setFocused(true);
                  open("search");
                }}
                onBlur={() => setFocused(false)}
                onSubmitEditing={submit}
                returnKeyType="search"
                placeholder="Search courts or areas"
                placeholderTextColor={t.colors.textSecondary}
                accessibilityLabel={expanded ? "Search courts or areas" : undefined}
                // outlineWidth: web's default ring would box only the bare
                // input; the field's border shows focus instead.
                style={[
                  t.type.body,
                  styles.searchInput,
                  { color: t.colors.textPrimary, outlineWidth: 0 },
                ]}
              />
              {!expanded && (
                <Pressable
                  onPress={startSearch}
                  accessibilityRole="search"
                  accessibilityLabel="Search courts or areas"
                  style={StyleSheet.absoluteFill}
                />
              )}
            </View>
            {mode === "list" ? (
              <Pressable
                onPress={() => open("filter")}
                accessibilityRole="button"
                accessibilityLabel={
                  activeFilterCount > 0 ? `Filters, ${activeFilterCount} on` : "Filters"
                }
                style={({ pressed }) => [
                  styles.filterButton,
                  {
                    backgroundColor: t.colors.surfaceMuted,
                    borderRadius: t.radius.md,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Ionicons name="options" size={20} color={t.colors.textPrimary} />
                {activeFilterCount > 0 && (
                  <View style={[styles.filterBadge, { backgroundColor: t.colors.accent }]}>
                    <Text
                      style={[t.type.caption, styles.filterBadgeText, { color: t.colors.onAccent }]}
                    >
                      {activeFilterCount}
                    </Text>
                  </View>
                )}
              </Pressable>
            ) : (
              <Pressable
                onPress={() => snap(false)}
                accessibilityRole="button"
                hitSlop={8}
                style={styles.cancel}
              >
                <Text style={[t.type.bodyMedium, { color: t.colors.accent }]}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
        <View style={styles.body} {...(mode === "list" ? listPan.panHandlers : {})}>
          {mode === "list" && (
            <CourtList
              courts={courts}
              onSelect={select}
              onScroll={listScroll.set}
              header={
                <Pressable
                  onPress={() => {
                    snap(false);
                    onAddCourt();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.addRow, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name="add-circle" size={20} color={t.colors.accent} />
                  <Text style={[t.type.bodyMedium, { color: t.colors.accent }]}>Add a court</Text>
                </Pressable>
              }
            />
          )}
          {mode === "search" &&
            (submitted ? (
              <DiscoveryResults
                result={result}
                onCourt={(court) => {
                  snap(false);
                  onSearchCourt(court);
                }}
                onArea={(area) => {
                  snap(false);
                  onSearchArea(area);
                }}
              />
            ) : (
              <Text style={[t.type.body, styles.hint, { color: t.colors.textSecondary }]}>
                Search by court name, neighborhood, or city.
              </Text>
            ))}
          {mode === "filter" && (
            <FilterPanel
              filters={filters}
              courts={courts}
              onApply={(f) => {
                onApplyFilters(f);
                setMode("list");
              }}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  // userSelect: a mouse drag on web would otherwise select the header text.
  header: { paddingHorizontal: 16, paddingBottom: 12, userSelect: "none" },
  grabberHit: { alignItems: "center", paddingTop: 8, paddingBottom: 10 },
  grabber: { width: 36, height: 5, borderRadius: 3 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  searchField: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingLeft: 12,
    borderWidth: 1.5,
  },
  searchInput: { flex: 1, minWidth: 0, height: 44, paddingRight: 12 },
  filterButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  filterBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeText: { fontSize: 11, lineHeight: 13 },
  cancel: { height: 44, justifyContent: "center", paddingHorizontal: 4 },
  divider: { height: StyleSheet.hairlineWidth },
  body: { flex: 1 },
  hint: { textAlign: "center", paddingHorizontal: 24, paddingVertical: 32 },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
});
