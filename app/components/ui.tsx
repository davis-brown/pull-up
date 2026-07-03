// Tiny shared UI kit: enough consistency for the MVP without a design system.
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

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
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "secondary" ? "#e8590c" : "#fff"} />
      ) : (
        <Text style={[styles.buttonText, variant === "secondary" && styles.secondaryText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, ...inputProps } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor="#999"
        autoCapitalize="none"
        {...inputProps}
      />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text style={styles.error}>{message}</Text>;
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
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    marginVertical: 6,
  },
  primary: { backgroundColor: "#e8590c" },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: "#e8590c",
  },
  danger: { backgroundColor: "#c92a2a" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  secondaryText: { color: "#e8590c" },
  field: { marginVertical: 8 },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 4, color: "#555" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    backgroundColor: "#fff",
  },
  error: { color: "#c92a2a", marginVertical: 8, fontSize: 14 },
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: { backgroundColor: "#e8590c", borderColor: "#e8590c" },
  chipText: { color: "#555", fontWeight: "600" },
  chipTextSelected: { color: "#fff" },
});
