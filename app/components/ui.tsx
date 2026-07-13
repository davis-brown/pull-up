// Themed UI kit. Every component reads design tokens from useTheme() —
// no hardcoded colors anywhere else in the app.
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
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
function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

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
  const background: Record<ButtonVariant, string> = {
    primary: t.colors.accent,
    secondary: "transparent",
    danger: "transparent",
    ghost: "transparent",
  };
  const pressedBackground: Record<ButtonVariant, string> = {
    primary: t.colors.accentPressed,
    secondary: t.colors.accentSurface,
    danger: t.colors.warningSurface,
    ghost: t.colors.surfaceMuted,
  };
  const label: Record<ButtonVariant, string> = {
    primary: t.colors.onAccent,
    secondary: t.colors.accent,
    danger: t.colors.danger,
    ghost: t.colors.textSecondary,
  };
  const borderColor: Record<ButtonVariant, string> = {
    primary: t.colors.accent,
    secondary: t.colors.accent,
    danger: t.colors.danger,
    ghost: "transparent",
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        compact ? styles.buttonCompact : null,
        variant === "primary" ? t.shadows.cta : null,
        {
          backgroundColor: pressed ? pressedBackground[variant] : background[variant],
          borderColor: borderColor[variant],
          borderRadius: 14,
          opacity: disabled || busy ? 0.45 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={label[variant]} />
      ) : (
        <Text style={[t.type.button, { color: label[variant] }]}>{title}</Text>
      )}
    </Pressable>
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
