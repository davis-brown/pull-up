// Themed UI kit. Every component reads design tokens from useTheme() —
// no hardcoded colors anywhere else in the app.
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/lib/theme";

// Applies an alpha channel to a theme hex color (e.g. surface at 92%
// opacity for the floating segmented toggle). Derives from a token value —
// not a new hardcoded color.
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

// Distance the border highlight travels per sweep; generous enough for
// full-bleed buttons on tablets while staying cheap (transform-only).
const SHEEN_TRAVEL = 640;
const RING_WIDTH = 2;

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = "primary",
  compact,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: ButtonVariant;
  /** Tighter padding for inline placements (e.g. inside a card row). */
  compact?: boolean;
}) {
  const t = useTheme();
  // Machined-metal border: primary/secondary sit inside a titanium gradient
  // ring. While hovered (web/pointer) a light band sweeps around the ring in
  // a loop; on touch, pressing fires one sweep. Press also settles the
  // button slightly via scale.
  const scale = useRef(new Animated.Value(1)).current;
  const sheenX = useRef(new Animated.Value(-SHEEN_TRAVEL / 2)).current;
  const sweepLoop = useRef<Animated.CompositeAnimation | null>(null);

  const singleSweep = () =>
    Animated.timing(sheenX, {
      toValue: SHEEN_TRAVEL / 2,
      duration: 700,
      useNativeDriver: true,
    });
  const hoverIn = () => {
    sheenX.setValue(-SHEEN_TRAVEL / 2);
    sweepLoop.current = Animated.loop(
      Animated.sequence([singleSweep(), Animated.delay(250)]),
      { resetBeforeIteration: true },
    );
    sweepLoop.current.start();
  };
  const hoverOut = () => {
    sweepLoop.current?.stop();
    sweepLoop.current = null;
    sheenX.setValue(-SHEEN_TRAVEL / 2);
  };
  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
    // Touch devices have no hover; give them one sweep per press.
    if (!sweepLoop.current) {
      sheenX.setValue(-SHEEN_TRAVEL / 2);
      singleSweep().start();
    }
  };
  const pressOut = () => {
    Animated.spring(scale, { toValue: 1, speed: 30, bounciness: 6, useNativeDriver: true }).start();
  };

  // primary and secondary wear the metal ring; danger and ghost stay flat so
  // destructive and quiet actions read as such.
  const ringed = variant === "primary" || variant === "secondary";
  const face: Record<ButtonVariant, string> = {
    primary: t.colors.accent,
    secondary: t.colors.surface,
    danger: "transparent",
    ghost: "transparent",
  };
  const pressedFace: Record<ButtonVariant, string> = {
    primary: t.colors.accentPressed,
    secondary: t.colors.surfaceMuted,
    danger: t.colors.warningSurface,
    ghost: t.colors.surfaceMuted,
  };
  const label: Record<ButtonVariant, string> = {
    primary: t.colors.onAccent,
    secondary: t.colors.textPrimary,
    danger: t.colors.danger,
    ghost: t.colors.textSecondary,
  };
  const content = busy ? (
    <ActivityIndicator color={label[variant]} />
  ) : (
    <Text style={[t.type.button, { color: label[variant] }]}>{title}</Text>
  );

  if (!ringed) {
    return (
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={onPress}
          disabled={disabled || busy}
          onPressIn={pressIn}
          onPressOut={pressOut}
          style={({ pressed }) => [
            styles.button,
            compact ? styles.buttonCompact : null,
            {
              backgroundColor: pressed ? pressedFace[variant] : "transparent",
              borderColor: variant === "danger" ? t.colors.danger : "transparent",
              borderRadius: 14,
              opacity: disabled || busy ? 0.45 : 1,
            },
          ]}
        >
          {content}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        disabled={disabled || busy}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={[
          styles.ring,
          variant === "primary" ? t.shadows.cta : null,
          { borderRadius: 14, opacity: disabled || busy ? 0.45 : 1 },
        ]}
      >
        {({ pressed }) => (
          <>
            {/* The ring: a metal gradient visible only through the padding
                gap around the face, plus the animated highlight band. */}
            <LinearGradient
              colors={[t.colors.metalTop, t.colors.metalBottom]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.ringSheen,
                { transform: [{ translateX: sheenX }, { rotate: "18deg" }] },
              ]}
            >
              <LinearGradient
                colors={["transparent", t.colors.sheen, "transparent"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View
              style={[
                styles.face,
                compact ? styles.faceCompact : null,
                {
                  borderRadius: 14 - RING_WIDTH,
                  backgroundColor: pressed ? pressedFace[variant] : face[variant],
                },
              ]}
            >
              {content}
            </View>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const t = useTheme();
  const { label, ...inputProps } = props;
  return (
    <View style={{ marginVertical: t.spacing.sm }}>
      <Text
        style={[
          t.type.label,
          { color: t.colors.textSecondary, marginBottom: t.spacing.xs + 2 },
        ]}
      >
        {label}
      </Text>
      <TextInput
        style={[
          t.type.body,
          styles.input,
          {
            borderColor: t.colors.border,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.surface,
            color: t.colors.textPrimary,
          },
        ]}
        placeholderTextColor={t.colors.textMuted}
        autoCapitalize="none"
        {...inputProps}
      />
    </View>
  );
}

export function FullScreenLoader() {
  const t = useTheme();
  return (
    <View style={[styles.fullScreenLoader, { backgroundColor: t.colors.background }]}>
      <ActivityIndicator size="large" color={t.colors.accent} />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const t = useTheme();
  if (!message) return null;
  return (
    <Text style={[t.type.caption, { color: t.colors.danger, marginVertical: t.spacing.sm }]}>
      {message}
    </Text>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderRadius: t.radius.full,
          borderColor: selected ? t.colors.textPrimary : t.colors.chipBorder,
          backgroundColor: selected ? t.colors.textPrimary : t.colors.surface,
        },
      ]}
    >
      {selected ? (
        <Ionicons name="checkmark" size={12} color={t.colors.surface} style={styles.chipIcon} />
      ) : null}
      <Text
        style={[
          t.type.caption,
          {
            fontFamily: t.fonts.bodyMedium,
            color: selected ? t.colors.surface : t.colors.textSecondary,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Card({
  children,
  tone = "default",
  style,
}: {
  children: ReactNode;
  tone?: "default" | "warning";
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: tone === "warning" ? t.colors.warningSurface : t.colors.surface,
          borderColor: tone === "warning" ? t.colors.warningBorder : t.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          marginBottom: t.spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Overline({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const t = useTheme();
  return <Text style={[t.type.overline, { color: t.colors.textMuted }, style]}>{children}</Text>;
}

export function SegmentedToggle({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.segmented,
        t.shadows.chrome,
        {
          backgroundColor: withAlpha(t.colors.surface, 0.92),
          borderRadius: t.radius.full,
        },
      ]}
    >
      {options.map((option) => {
        const active = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={[
              styles.segment,
              {
                borderRadius: t.radius.full,
                backgroundColor: active ? t.colors.textPrimary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                t.type.button,
                {
                  fontSize: 15,
                  color: active ? t.colors.surface : t.colors.textSecondary,
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreenLoader: { flex: 1, alignItems: "center", justifyContent: "center" },
  button: {
    borderWidth: 1.5,
    paddingVertical: 13,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 6,
    minHeight: 48,
  },
  buttonCompact: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginVertical: 0,
    minHeight: 40,
  },
  ring: {
    padding: RING_WIDTH,
    marginVertical: 6,
    overflow: "hidden",
  },
  ringSheen: {
    position: "absolute",
    top: -20,
    bottom: -20,
    width: 90,
    left: "50%",
    marginLeft: -45,
  },
  face: {
    paddingVertical: 13 - RING_WIDTH,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48 - RING_WIDTH * 2,
  },
  faceCompact: {
    paddingVertical: 8 - RING_WIDTH,
    minHeight: 40 - RING_WIDTH * 2,
  },
  input: {
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  chipIcon: {
    marginRight: 4,
  },
  segmented: {
    flexDirection: "row",
    padding: 3,
    alignSelf: "flex-start",
  },
  segment: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
});
