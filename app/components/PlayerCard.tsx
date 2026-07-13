// The shareable player card (profile screen, spec 3e). The header is
// always rendered in the dark palette regardless of the user's theme
// preference — captured via view-shot for sharing, so it needs a fixed,
// on-brand look rather than adapting to light/dark.
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import type { Ref } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "@/components/Avatar";
import { Overline, withAlpha } from "@/components/ui";
import { BADGES, STYLE_TAGS, playerSubline } from "@/lib/player";
import { darkTheme, useTheme } from "@/lib/theme";
import type { MeStats, User } from "@/lib/types";

export type PlayerCardUser = Pick<
  User,
  "id" | "display_name" | "avatar_url" | "jersey_number" | "position" | "height_cm" | "style_tags"
>;

export function PlayerCard({
  user,
  stats,
  innerRef,
}: {
  user: PlayerCardUser;
  stats?: MeStats;
  innerRef?: Ref<View>;
}) {
  const t = useTheme();
  const dark = darkTheme();
  const router = useRouter();

  const subline = playerSubline(user);
  const games = stats?.games ?? 0;
  const courts = stats?.courts ?? 0;
  const weekStreak = stats?.week_streak ?? 0;
  const badgeById = new Map((stats?.badges ?? []).map((b) => [b.id, b.earned]));
  const homeCourts = stats?.home_courts ?? [];

  return (
    <View
      ref={innerRef}
      style={[
        styles.card,
        t.shadows.sheet,
        { borderRadius: 20, backgroundColor: t.colors.surface },
      ]}
    >
      <View style={[styles.header, { backgroundColor: dark.colors.background }]}>
        {user.jersey_number != null ? (
          <Text
            style={[
              styles.watermark,
              {
                fontFamily: dark.fonts.condensedHeavy,
                color: withAlpha(dark.colors.accent, 0.18),
              },
            ]}
            numberOfLines={1}
          >
            {user.jersey_number}
          </Text>
        ) : null}
        <View style={styles.headerRow}>
          <View style={[styles.avatarRing, { borderColor: dark.colors.accent }]}>
            <Avatar
              avatarUrl={user.avatar_url}
              displayName={user.display_name}
              seed={user.id}
              size={64}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={[dark.type.display, { color: dark.colors.textPrimary, fontSize: 22 }]} numberOfLines={1}>
              {user.display_name}
            </Text>
            {subline ? (
              <Text style={[dark.type.caption, { color: dark.colors.textMuted, marginTop: 4 }]}>
                {subline}
              </Text>
            ) : null}
          </View>
        </View>
      </View>

      <View style={[styles.statsStrip, { backgroundColor: t.colors.surface }]}>
        <StatColumn value={games} label="GAMES" />
        <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
        <StatColumn value={courts} label="COURTS" />
        <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
        <StatColumn value={weekStreak} label="WK STREAK" accent />
      </View>

      {user.style_tags.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.chipsRow}>
            {user.style_tags.map((key, i) => {
              const tag = STYLE_TAGS.find((s) => s.key === key);
              if (!tag) return null;
              const first = i === 0;
              return (
                <View
                  key={key}
                  style={[
                    styles.styleChip,
                    {
                      borderRadius: t.radius.full,
                      backgroundColor: first ? t.colors.accentSurface : t.colors.surfaceMuted,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.type.caption,
                      {
                        fontFamily: t.fonts.bodyMedium,
                        color: first ? t.colors.accentPressed : t.colors.textSecondary,
                      },
                    ]}
                  >
                    {tag.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Overline style={{ marginBottom: t.spacing.sm }}>BADGES</Overline>
        <View style={styles.badgeGrid}>
          {BADGES.map((b) => {
            const earned = badgeById.get(b.id) ?? false;
            return (
              <View
                key={b.id}
                style={[
                  styles.badgeCard,
                  { borderRadius: 16, backgroundColor: t.colors.surfaceMuted },
                ]}
              >
                {earned ? (
                  <Ionicons
                    name={b.icon as keyof typeof Ionicons.glyphMap}
                    size={22}
                    color={t.colors.accent}
                  />
                ) : (
                  <Text style={[styles.badgeLocked, { color: t.colors.textMuted }]}>?</Text>
                )}
                <Text
                  style={[
                    t.type.caption,
                    {
                      color: earned ? t.colors.textPrimary : t.colors.textMuted,
                      opacity: earned ? 1 : 0.45,
                      marginTop: 4,
                      textAlign: "center",
                    },
                  ]}
                  numberOfLines={1}
                >
                  {b.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {homeCourts.length > 0 ? (
        <View style={styles.section}>
          <Overline style={{ marginBottom: t.spacing.sm }}>HOME COURTS</Overline>
          {homeCourts.map((hc) => (
            <Pressable
              key={hc.court_id}
              onPress={() => router.push(`/court/${hc.court_id}` as Href)}
              style={[
                styles.courtRow,
                { borderRadius: 16, backgroundColor: t.colors.surface, borderColor: t.colors.border },
              ]}
            >
              <View style={[styles.courtThumb, { backgroundColor: t.colors.surfaceMuted }]}>
                <Ionicons name="location" size={20} color={t.colors.textMuted} />
              </View>
              <View style={styles.courtInfo}>
                <Text style={[t.type.heading, { color: t.colors.textPrimary }]} numberOfLines={1}>
                  {hc.name}
                </Text>
                <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
                  {hc.check_ins} check-ins
                </Text>
              </View>
              {hc.live_count > 0 ? (
                <View style={[styles.liveDot, { backgroundColor: t.colors.live }]} />
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function StatColumn({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.statColumn}>
      <Text
        style={{
          fontFamily: t.fonts.condensedHeavy,
          fontSize: 26,
          color: accent ? t.colors.accent : t.colors.textPrimary,
        }}
      >
        {value}
      </Text>
      <Text style={[t.type.overline, { color: t.colors.textMuted, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    marginBottom: 16,
    paddingBottom: 16,
  },
  header: {
    padding: 20,
    overflow: "hidden",
  },
  watermark: {
    position: "absolute",
    top: -28,
    right: -8,
    fontSize: 130,
    lineHeight: 130,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerText: {
    marginLeft: 16,
    flexShrink: 1,
  },
  avatarRing: {
    borderWidth: 3,
    borderRadius: 35,
    padding: 2,
  },
  statsStrip: {
    flexDirection: "row",
  },
  statColumn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 16,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
  },
  section: {
    paddingHorizontal: 16,
    marginTop: 16,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: -8,
  },
  styleChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
  },
  badgeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  badgeCard: {
    width: "31%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    marginBottom: 10,
  },
  badgeLocked: {
    fontSize: 22,
    fontWeight: "700",
    opacity: 0.45,
  },
  courtRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 8,
    gap: 12,
  },
  courtThumb: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  courtInfo: {
    flex: 1,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
