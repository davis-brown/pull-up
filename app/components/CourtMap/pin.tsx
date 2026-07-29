import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { pinVariant } from "@/lib/pin-size";
import { useTheme, type Theme } from "@/lib/theme";
import type { CourtPin } from "./types";

// Shared pin for both map implementations.
//
// "all" mode gives every court an equal-weight look, unaffected by selection
// or activity. "now" mode weights pins by expectedCount: quiet unselected
// courts shrink to dots, the selected pin grows and gains a halo and label.
// Sizing is decided by the pure app/lib/pin-size.ts helper.
export function CourtPinMarker({
  pin,
  mode,
  selected = false,
  hovered = false,
  onPress,
}: {
  pin: CourtPin;
  mode: "now" | "all";
  selected?: boolean;
  /** Desktop web: the panel is hovering this court, so raise a quiet dot to
   * a full 36px pin. */
  hovered?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();

  if (mode === "all") {
    return <AllCourtsPin pin={pin} onPress={onPress} t={t} />;
  }

  const count = pin.expectedCount ?? pin.activeCount;
  const variant = pinVariant(count, selected);

  if (variant.kind === "dot") {
    if (hovered) {
      // Quiet and hovered: an accent pin with a glyph, since there is no
      // player count to show.
      return (
        <Pressable onPress={onPress} hitSlop={8}>
          <View
            style={[
              styles.countPin,
              t.shadows.pin,
              {
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: t.colors.accent,
                borderColor: t.colors.surface,
              },
            ]}
          >
            <Ionicons name="basketball" size={18} color={t.colors.onAccent} />
            {pinBadges(pin, t)}
          </View>
        </Pressable>
      );
    }
    // Kept far lighter than any count pin so "now" mode's hierarchy reads.
    return (
      <Pressable onPress={onPress} hitSlop={12}>
        <View>
          <View
            style={[
              styles.quietDot,
              { backgroundColor: t.colors.quietDot, borderColor: t.colors.surface },
            ]}
          />
          {pinBadges(pin, t)}
        </View>
      </Pressable>
    );
  }

  const size = variant.size;

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View style={styles.pinColumn}>
        <View style={{ width: size, height: size }}>
          {selected && <PulseHalo color={t.colors.accent} size={size} />}
          <View
            style={[
              styles.countPin,
              t.shadows.pin,
              {
                position: "absolute",
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: t.colors.accent,
                borderColor: t.colors.surface,
              },
            ]}
          >
            <Text
              style={{
                fontFamily: t.fonts.condensedHeavy,
                fontSize: 22,
                color: t.colors.onAccent,
              }}
            >
              {count}
            </Text>
          </View>
          {pinBadges(pin, t)}
        </View>
        {selected && (
          <View
            style={[
              styles.labelChip,
              { backgroundColor: t.colors.textPrimary, borderRadius: t.radius.full },
            ]}
          >
            <Text style={[t.type.overline, { color: t.colors.surface }]}>{pin.name}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

// The corner markers every pin variant carries. Both are absolute-positioned
// and sit on opposite corners, so a court can be both scheduled and paid
// without either mark moving.
function pinBadges(pin: CourtPin, t: Theme) {
  return (
    <>
      {pin.nextRunAt ? <RunTick t={t} /> : null}
      {pin.paid || pin.restricted ? <CostBadge t={t} paid={!!pin.paid} /> : null}
    </>
  );
}

// Marks a court that is not free and open to all: a $ for pay-to-play, a lock
// for private or customers-only. Cost wins when a court is both, since it is
// the harder constraint to discover on arrival.
function CostBadge({ t, paid }: { t: Theme; paid: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.costBadge,
        // Inverted against the pin — several variants are accent-filled, and
        // a surface-on-ink badge stays legible on all of them.
        { backgroundColor: t.colors.surface, borderColor: t.colors.textPrimary },
      ]}
    >
      {paid ? (
        <Text style={[styles.costGlyph, { color: t.colors.textPrimary }]}>$</Text>
      ) : (
        <Ionicons name="lock-closed" size={8} color={t.colors.textPrimary} />
      )}
    </View>
  );
}

// Marks a court with a run scheduled in the next 24h. Absolute-positioned so
// every pin variant can carry it without reflowing.
function RunTick({ t }: { t: Theme }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.runTick,
        // Ink, not accent: several pin variants are themselves accent-colored.
        { backgroundColor: t.colors.textPrimary, borderColor: t.colors.surface },
      ]}
    />
  );
}

// Grows from 0.6x to 1.4x while fading out, looping every 2s. useNativeDriver
// stays off so the same code path runs on react-native-web.
function PulseHalo({ color, size }: { color: string; size: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.4] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.halo,
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

// "all" mode's marker: a quiet badge, or a green live bubble with the player
// count. Untouched by "now" mode's weighting and selection.
function AllCourtsPin({
  pin,
  onPress,
  t,
}: {
  pin: CourtPin;
  onPress?: () => void;
  t: Theme;
}) {
  const live = pin.activeCount > 0;
  const pending = pin.status === "pending";

  if (!live) {
    return (
      <Pressable onPress={onPress} hitSlop={12}>
        <View>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: pending ? t.colors.surface : t.colors.accent,
                borderColor: pending ? t.colors.textMuted : t.colors.surface,
              },
            ]}
          >
            <Ionicons
              name="basketball"
              size={13}
              color={pending ? t.colors.textMuted : t.colors.onAccent}
            />
          </View>
          {pinBadges(pin, t)}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View>
        <View
          style={[
            styles.liveBubble,
            { backgroundColor: t.colors.live, borderColor: t.colors.surface },
          ]}
        >
          <Text style={styles.liveCount}>{pin.activeCount}</Text>
        </View>
        {pinBadges(pin, t)}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  liveBubble: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  liveCount: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  quietDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  pinColumn: {
    alignItems: "center",
  },
  countPin: {
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  halo: {},
  runTick: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  costBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  costGlyph: {
    fontSize: 9,
    fontWeight: "800",
    lineHeight: 11,
  },
  labelChip: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
});
