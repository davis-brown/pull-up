// Themed UI kit. Every component reads design tokens from useTheme() —
// no hardcoded colors anywhere else in the app.
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
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/lib/theme";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  title,
  onPress,
  disabled,
  busy,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: ButtonVariant;
}) {
  const t = useTheme();
  const background: Record<ButtonVariant, string> = {
    primary: t.colors.accent,
    secondary: "transparent",
    danger: "transparent",
    ghost: "transparent",
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
        {
          backgroundColor: background[variant],
          borderColor: borderColor[variant],
          borderRadius: t.radius.md,
          opacity: disabled || busy ? 0.45 : pressed ? 0.82 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={label[variant]} />
      ) : (
        <Text style={[t.type.bodyMedium, { color: label[variant] }]}>{title}</Text>
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
          borderColor: selected ? t.colors.accent : t.colors.border,
          backgroundColor: selected ? t.colors.accent : t.colors.surface,
        },
      ]}
    >
      <Text
        style={[
          t.type.caption,
          {
            fontWeight: "500",
            color: selected ? t.colors.onAccent : t.colors.textSecondary,
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
  input: {
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  chip: {
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
  },
});
