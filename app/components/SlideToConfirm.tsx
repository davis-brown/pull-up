import { Ionicons } from "@expo/vector-icons";
import { useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  type LayoutChangeEvent,
} from "react-native";
import { darkTheme } from "@/lib/theme";

const TRACK_HEIGHT = 64;
const THUMB_SIZE = 54;
const THUMB_INSET = 5;
const CONFIRM_THRESHOLD = 0.8;

// The dark check-in screen's slide-to-confirm control (spec 3d). Always
// dark — it only ever appears on the always-dark check-in modal, so it
// pulls its palette straight from darkTheme() rather than useTheme().
//
// Drag via PanResponder + an Animated.Value tracking thumb translateX.
// Releasing past 80% of the track snaps to the end and fires onConfirm;
// releasing short of that springs back. RN Web supports PanResponder
// drags, but a plain tap doesn't produce pan deltas, so a Pressable on
// the thumb also fires onConfirm there.

export function SlideToConfirm({
  label,
  onConfirm,
  disabled,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const t = darkTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);
  const firedRef = useRef(false);

  const maxTranslate = Math.max(trackWidth - THUMB_SIZE - THUMB_INSET * 2, 0);

  const fire = () => {
    if (firedRef.current || disabled) return;
    firedRef.current = true;
    Animated.timing(translateX, {
      toValue: maxTranslate,
      duration: 150,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    onConfirm();
  };

  const springBack = () => {
    firedRef.current = false;
    Animated.spring(translateX, {
      toValue: 0,
      friction: 7,
      useNativeDriver: true,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !firedRef.current,
        onMoveShouldSetPanResponder: () => !disabled && !firedRef.current,
        onPanResponderGrant: () => {
          translateX.stopAnimation((value) => {
            dragStart.current = value;
          });
        },
        onPanResponderMove: (_evt, gesture) => {
          if (disabled || maxTranslate <= 0) return;
          const next = Math.min(
            Math.max(dragStart.current + gesture.dx, 0),
            maxTranslate,
          );
          translateX.setValue(next);
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (disabled || maxTranslate <= 0) return;
          const next = Math.min(
            Math.max(dragStart.current + gesture.dx, 0),
            maxTranslate,
          );
          if (next >= maxTranslate * CONFIRM_THRESHOLD) {
            fire();
          } else {
            springBack();
          }
        },
        onPanResponderTerminate: () => springBack(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabled, maxTranslate],
  );

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  const labelOpacity = translateX.interpolate({
    inputRange: [0, Math.max(maxTranslate * 0.6, 1)],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        styles.track,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderRadius: t.radius.full,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <Animated.Text
        style={[
          t.type.button,
          styles.label,
          { color: t.colors.textMuted, opacity: labelOpacity },
        ]}
      >
        {label}
      </Animated.Text>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.thumb,
          {
            backgroundColor: t.colors.accent,
            transform: [{ translateX }],
          },
          t.shadows.cta,
        ]}
      >
        <Pressable
          onPress={() => {
            if (Platform.OS === "web") fire();
          }}
          disabled={disabled}
          hitSlop={10}
          style={styles.thumbPress}
        >
          <Ionicons name="arrow-forward" size={24} color={t.colors.onAccent} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  label: {
    fontSize: 17,
    letterSpacing: 0.14 * 17,
  },
  thumb: {
    position: "absolute",
    left: THUMB_INSET,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbPress: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
});
