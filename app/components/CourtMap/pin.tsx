import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { pinVariant } from "@/lib/pin-size";
import { useTheme, type Theme } from "@/lib/theme";
import type { CourtPin } from "./types";

// Shared pin for both map implementations.
//
// "all" mode keeps the original equal-weight look for every court (a quiet
// basketball badge, or a green live bubble with the current player count) —
// unaffected by selection or activity weighting.
//
// "now" mode weights pins by expectedCount: a quiet, unselected court shrinks
// to a dot; everything else is an orange count pin; the selected pin grows
// to 52px, gains a pulsing halo, and drops an ink label chip with the court
// name below it. Sizing is decided by the pure app/lib/pin-size.ts helper.
export function CourtPinMarker({
  pin,
  mode,
  selected = false,
  onPress,
}: {
  pin: CourtPin;
  mode: "now" | "all";
  selected?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();

  if (mode === "all") {
    return <AllCourtsPin pin={pin} onPress={onPress} t={t} />;
  }

  const count = pin.expectedCount ?? pin.activeCount;
  const variant = pinVariant(count, selected);

  if (variant.kind === "dot") {
    return (
      <Pressable onPress={onPress} hitSlop={12}>
        <View style={[styles.quietDot, { backgroundColor: t.colors.quietDot }]} />
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

// Grows from 0.6x to 1.4x its own size while fading out, looping every 2s.
// useNativeDriver stays off so the same code path runs unmodified on
// react-native-web (no native animated module there).
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

// The pre-Task-8 marker: a quiet basketball badge, or a green live bubble
// with the player count. Untouched by "now" mode's weighting/selection.
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
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View
        style={[
          styles.liveBubble,
          { backgroundColor: t.colors.live, borderColor: t.colors.surface },
        ]}
      >
        <Text style={styles.liveCount}>{pin.activeCount}</Text>
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
  labelChip: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
});
