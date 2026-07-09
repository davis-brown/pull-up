import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { markOnboardingSeen } from "@/lib/first-run";
import { useTheme } from "@/lib/theme";

const slides: Array<{
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}> = [
  {
    icon: "map-outline",
    title: "Find live pickup basketball",
    body: "A map of courts near you that shows who's playing right now — powered by players, for players.",
  },
  {
    icon: "basketball-outline",
    title: "Check in when you pull up",
    body: "Check-ins are verified at the court and expire on their own, so the map always shows a real run.",
  },
  {
    icon: "people-outline",
    title: "Plan runs with your court",
    body: "RSVP to planned runs, get a ping when your favorite court has one, and talk in court chat.",
  },
];

export default function OnboardingScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const last = index === slides.length - 1;

  const finish = async (destination: "/" | "/login") => {
    await markOnboardingSeen();
    router.replace(destination);
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: t.colors.background,
          paddingTop: insets.top + t.spacing.xl,
          paddingBottom: insets.bottom + t.spacing.lg,
          paddingHorizontal: t.spacing.xl,
        },
      ]}
    >
      <Pressable onPress={() => void finish("/")} hitSlop={10} style={styles.skip}>
        <Text style={[t.type.bodyMedium, { color: t.colors.textMuted }]}>Skip</Text>
      </Pressable>

      <View style={styles.body}>
        <Ionicons name={slide.icon} size={72} color={t.colors.accent} />
        <Text
          style={[t.type.title, styles.text, { color: t.colors.textPrimary, marginTop: t.spacing.xl }]}
        >
          {slide.title}
        </Text>
        <Text
          style={[t.type.body, styles.text, { color: t.colors.textSecondary, marginTop: t.spacing.md }]}
        >
          {slide.body}
        </Text>
      </View>

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: i === index ? t.colors.accent : t.colors.border,
              },
            ]}
          />
        ))}
      </View>

      {last ? (
        <>
          <Button title="Explore courts" onPress={() => void finish("/")} />
          <Button title="Sign in" variant="secondary" onPress={() => void finish("/login")} />
        </>
      ) : (
        <Button title="Next" onPress={() => setIndex(index + 1)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skip: { alignSelf: "flex-end" },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  text: { textAlign: "center", maxWidth: 420 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
