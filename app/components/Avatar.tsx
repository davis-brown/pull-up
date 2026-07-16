import { Image, StyleSheet, Text, View } from "react-native";
import { photoURL } from "@/lib/hooks";
import { avatarColor, initials } from "@/lib/avatar";
import { useTheme } from "@/lib/theme";

// A player's avatar: uploaded image when set, else deterministic initials.
// `avatarUrl` is the stored path (e.g. "/photos/avatars/..") or null.
export function Avatar({
  avatarUrl,
  displayName,
  seed,
  size = 40,
}: {
  avatarUrl: string | null;
  displayName: string;
  seed: string;
  size?: number;
}) {
  const t = useTheme();
  const radius = size / 2;
  if (avatarUrl?.startsWith("/photos/")) {
    const uri = photoURL(avatarUrl.slice("/photos/".length));
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: t.colors.surface }}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: avatarColor(seed) },
      ]}
    >
      <Text style={{ fontFamily: t.fonts.bodyBold, color: "#fff", fontSize: size * 0.4 }}>
        {initials(displayName)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
});
