import { useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useTheme } from "@/lib/theme";

const TRACK_HEIGHT = 6;
const THUMB_SIZE = 24;

// "10 PM" -> "10P", "2 AM" -> "2A". Used for the scrubber's end labels.
function shortHourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const period = h < 12 ? "A" : "P";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}${period}`;
}

// Draggable time scrubber over a contiguous set of hours (see
// lib/forecast.ts#scrubHours). Snaps to whole hours and never fetches;
// onChange just moves a local index.
export function TimeScrubber({
  hours,
  value,
  onChange,
}: {
  hours: number[];
  value: number;
  onChange: (hour: number) => void;
}) {
  const t = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const startXRef = useRef(0);

  const steps = Math.max(hours.length - 1, 1);
  const currentIndex = Math.max(hours.indexOf(value), 0);
  const fraction = hours.length > 1 ? currentIndex / steps : 0;

  const applyX = (x: number) => {
    if (trackWidth <= 0 || hours.length === 0) return;
    const clamped = Math.min(Math.max(x, 0), trackWidth);
    const nearestIndex = Math.min(
      Math.max(Math.round((clamped / trackWidth) * steps), 0),
      hours.length - 1,
    );
    const hour = hours[nearestIndex];
    if (hour !== value) onChange(hour);
  };

  // The PanResponder is created once, so its callbacks would close over the
  // first render's applyX (trackWidth 0). Route through a ref instead.
  const applyXRef = useRef(applyX);
  applyXRef.current = applyX;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        startXRef.current = e.nativeEvent.locationX;
        applyXRef.current(startXRef.current);
      },
      onPanResponderMove: (_e, gestureState) => {
        applyXRef.current(startXRef.current + gestureState.dx);
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrap}>
      <Text style={[t.type.overline, { color: t.colors.textMuted }]}>NOW</Text>
      <View style={styles.trackArea} onLayout={onLayout} {...panResponder.panHandlers}>
        <View
          style={[
            styles.track,
            { backgroundColor: t.colors.surfaceMuted, borderRadius: TRACK_HEIGHT / 2 },
          ]}
        >
          <View
            style={[
              styles.fill,
              {
                width: `${fraction * 100}%`,
                backgroundColor: t.colors.accent,
                borderRadius: TRACK_HEIGHT / 2,
              },
            ]}
          />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: `${fraction * 100}%`,
              backgroundColor: t.colors.surface,
              borderColor: t.colors.accent,
            },
          ]}
        />
      </View>
      <Text style={[t.type.overline, { color: t.colors.textMuted }]}>
        {shortHourLabel(hours[hours.length - 1] ?? 22)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  trackArea: {
    flex: 1,
    height: THUMB_SIZE,
    justifyContent: "center",
  },
  track: {
    height: TRACK_HEIGHT,
    width: "100%",
    overflow: "hidden",
  },
  fill: {
    height: TRACK_HEIGHT,
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    marginLeft: -THUMB_SIZE / 2,
  },
});
