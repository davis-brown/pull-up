import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { RunRow } from "@/components/court/RunRow";
import { useSignInDetour } from "@/components/SignInCta";
import { Button, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { externalPhotoURL, photoURL, useCourt, useCourtPhotos, useCourtSessions, useRSVP } from "@/lib/hooks";
import { safePathSegment } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { CourtDetail, CourtSummary, SessionSummary } from "@/lib/types";

// The desktop master-detail sidebar (design 3f). Rendered by the map home only
// on wide web viewports; it swaps between a scrollable court list and a single
// court's detail entirely from `selectedId` — no navigation. Hovering a list
// row raises that court's pin on the map via `onHover`.
export function DesktopPanel({
  courts,
  selectedId,
  onSelect,
  onHover,
}: {
  courts: CourtSummary[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const t = useTheme();

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: t.colors.surface, borderRightColor: t.colors.border },
      ]}
    >
      {selectedId == null ? (
        <ListLevel courts={courts} onSelect={onSelect} onHover={onHover} />
      ) : (
        <DetailLevel
          selectedId={selectedId}
          summary={courts.find((c) => c.id === selectedId) ?? null}
          onBack={() => onSelect(null)}
        />
      )}
    </View>
  );
}

// The court's one-line attribute summary: "Outdoor · 2 hoops · Lights · Asphalt".
function attributeLine(court: CourtSummary | CourtDetail): string {
  return [
    court.indoor ? "Indoor" : "Outdoor",
    court.hoop_count != null ? `${court.hoop_count} hoops` : null,
    court.lighting ? "Lights" : null,
    court.surface ? court.surface.charAt(0).toUpperCase() + court.surface.slice(1) : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
}

function attributeChips(court: CourtSummary | CourtDetail): string[] {
  return [
    court.indoor ? "Indoor" : "Outdoor",
    court.hoop_count != null ? `${court.hoop_count} hoops` : null,
    court.lighting ? "Lights" : null,
    court.surface ? court.surface.charAt(0).toUpperCase() + court.surface.slice(1) : null,
  ].filter((v): v is string => Boolean(v));
}

function ListLevel({
  courts,
  onSelect,
  onHover,
}: {
  courts: CourtSummary[];
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const t = useTheme();
  return (
    <ScrollView contentContainerStyle={styles.listContent}>
      <Text style={[t.type.displayCondensed, styles.header, { color: t.colors.textPrimary }]}>
        Courts near you
      </Text>
      {courts.map((court) => (
        <Pressable
          key={court.id}
          onPress={() => onSelect(court.id)}
          onHoverIn={() => onHover(court.id)}
          onHoverOut={() => onHover(null)}
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: t.colors.border,
              backgroundColor: pressed ? t.colors.background : "transparent",
            },
          ]}
        >
          <View style={styles.rowBody}>
            <Text style={[t.type.heading, { color: t.colors.textPrimary }]} numberOfLines={1}>
              {court.name}
            </Text>
            <Text
              style={[t.type.caption, styles.rowAttrs, { color: t.colors.textSecondary }]}
              numberOfLines={1}
            >
              {attributeLine(court)}
            </Text>
          </View>
          {court.active_count > 0 && (
            <Text
              style={[
                styles.rowCount,
                { fontFamily: t.fonts.condensedHeavy, color: t.colors.accent },
              ]}
            >
              {court.active_count}
            </Text>
          )}
        </Pressable>
      ))}
      {courts.length === 0 && (
        <Text style={[t.type.caption, styles.empty, { color: t.colors.textMuted }]}>
          No courts in view yet — pan or zoom the map to find some.
        </Text>
      )}
    </ScrollView>
  );
}

function DetailLevel({
  selectedId,
  summary,
  onBack,
}: {
  selectedId: string;
  summary: CourtSummary | null;
  onBack: () => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const detour = useSignInDetour();
  // Deep links can select a court that isn't in the loaded viewport set, so
  // fetch the full detail; fall back to the list summary while it loads.
  const { data: detail } = useCourt(selectedId);
  const { data: photoData } = useCourtPhotos(selectedId);
  const { data: sessions } = useCourtSessions(selectedId);
  const rsvp = useRSVP(selectedId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [selectedId]);

  const court: CourtDetail | CourtSummary | null = detail ?? summary;

  const photo = photoData?.photos?.[0];
  const externalPhoto = photoData?.external?.[0];
  const photoUri = photo
    ? photoURL(photo.storage_key)
    : externalPhoto
      ? externalPhotoURL(externalPhoto.source, externalPhoto.source_id)
      : null;

  const liveCount = court?.active_count ?? 0;
  const live = liveCount > 0;

  // Today's first still-upcoming run, shown as a single joinable row.
  const nextRun = (() => {
    if (!sessions) return null;
    const now = Date.now();
    const isToday = (iso: string) => {
      const d = new Date(iso);
      const n = new Date();
      return (
        d.getFullYear() === n.getFullYear() &&
        d.getMonth() === n.getMonth() &&
        d.getDate() === n.getDate()
      );
    };
    const upcoming = sessions
      .filter((s) => new Date(s.starts_at).getTime() >= now && isToday(s.starts_at))
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    const s = upcoming[0];
    if (!s) return null;
    const view: SessionSummary = {
      id: s.id,
      starts_at: s.starts_at,
      going_count: s.going_count,
      host_name: s.created_by_name,
    };
    return view;
  })();

  const joinRun = (sessionId: string) => {
    if (!user) return detour();
    setError(null);
    rsvp.mutate(
      { sessionId, status: "going" },
      { onError: (e) => setError(e.message) },
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.backRow}>
        <Pressable
          onPress={onBack}
          style={[styles.backButton, { backgroundColor: t.colors.background }]}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={18} color={t.colors.textPrimary} />
        </Pressable>
        <Overline>Back to list</Overline>
      </View>

      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.photo} />
      ) : (
        <View style={[styles.photo, { backgroundColor: t.colors.surfaceMuted }]} />
      )}

      {court && (
        <>
          <Text style={[t.type.display, styles.title, { color: t.colors.textPrimary }]}>
            {court.name}
          </Text>
          {court.address ? (
            <Text style={[t.type.caption, styles.subline, { color: t.colors.textSecondary }]}>
              {court.address}
            </Text>
          ) : null}

          <View style={styles.chips}>
            {attributeChips(court).map((label) => (
              <View
                key={label}
                style={[styles.chip, { backgroundColor: t.colors.surfaceMuted }]}
              >
                <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>{label}</Text>
              </View>
            ))}
          </View>

          {/* Live card. Avatars are intentionally omitted: the court list/detail
              payloads carry no avatar_url, so a stack would need the activity
              endpoint — deferred per the brief. */}
          <View style={[styles.liveCard, { backgroundColor: t.colors.background }]}>
            <View style={styles.liveRow}>
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: live ? t.colors.live : t.colors.quietDot },
                ]}
              />
              <Text style={[t.type.heading, { color: t.colors.textPrimary }]}>
                {live ? `${liveCount} playing now` : "No one playing now"}
              </Text>
            </View>
            <Button title="Check in" onPress={() => router.push(`/check-in?courtId=${safePathSegment(selectedId)}`)} />
          </View>

          {nextRun && (
            <View style={styles.runSection}>
              <Overline style={styles.runHeading}>Next run today</Overline>
              <RunRow session={nextRun} onJoin={() => joinRun(nextRun.id)} />
            </View>
          )}
          <ErrorText message={error} />
        </>
      )}
    </ScrollView>
  );
}

const PANEL_WIDTH = 340;

const styles = StyleSheet.create({
  panel: {
    width: PANEL_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  listContent: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1 },
  rowAttrs: { marginTop: 2 },
  rowCount: {
    fontSize: 22,
  },
  empty: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  detailContent: {
    padding: 20,
    paddingBottom: 32,
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  photo: {
    height: 150,
    borderRadius: 16,
    width: "100%",
  },
  title: {
    marginTop: 16,
  },
  subline: {
    marginTop: 6,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
  chip: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  liveCard: {
    borderRadius: 16,
    padding: 16,
    marginTop: 20,
    gap: 12,
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  runSection: {
    marginTop: 24,
  },
  runHeading: {
    marginBottom: 10,
  },
});
