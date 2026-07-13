import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { bannerDismissed, dismissBanner } from "@/lib/app-banner";
import { useTheme } from "@/lib/theme";

// Store URLs are injected into the web build via EXPO_PUBLIC_* so the banner
// links out without bundling native store logic.
const IOS_URL = process.env.EXPO_PUBLIC_IOS_STORE_URL ?? "";
const ANDROID_URL = process.env.EXPO_PUBLIC_ANDROID_STORE_URL ?? "";

// Dismissible "pull-up is better in the app" nudge. Web only; hidden inside
// the native app and once dismissed.
export function GetTheAppBanner() {
  const t = useTheme();
  const [hidden, setHidden] = useState(Platform.OS !== "web" || bannerDismissed());
  if (hidden) return null;

  const storeUrl = IOS_URL || ANDROID_URL;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: t.colors.surface, borderBottomColor: t.colors.border },
      ]}
    >
      <Text style={[t.type.caption, { color: t.colors.textPrimary, flex: 1 }]}>
        pull-up is better in the app.
        {storeUrl ? " " : ""}
        {storeUrl ? (
          <Text
            style={{ color: t.colors.accent, fontFamily: t.fonts.bodySemi }}
            onPress={() => void Linking.openURL(storeUrl)}
          >
            Get it
          </Text>
        ) : null}
      </Text>
      <Pressable
        onPress={() => {
          dismissBanner();
          setHidden(true);
        }}
        hitSlop={10}
      >
        <Ionicons name="close" size={18} color={t.colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
