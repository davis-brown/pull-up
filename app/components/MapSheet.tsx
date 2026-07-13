import { usePathname, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TimeScrubber } from "@/components/TimeScrubber";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { expectedAt, sessionAt, type CourtForecast } from "@/lib/forecast";
import { useRSVP } from "@/lib/hooks";
import { signInHref } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { CourtSummary } from "@/lib/types";

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour} ${h < 12 ? "AM" : "PM"}`;
}

// Bottom sheet for the map home's "Now" mode: today's time scrubber plus the
// selected court's live/forecast turnout. Scrubbing is purely local — the
// forecast data is already in props (fetched once per visible id set by
// useForecasts), so dragging the thumb triggers zero network requests.
export function MapSheet({
  court,
  hours,
  scrubHour,
  onScrub,
  forecast,
}: {
  court: CourtSummary;
  hours: number[];
  scrubHour: number;
  onScrub: (hour: number) => void;
  forecast: CourtForecast | undefined;
}) {
  const t = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const rsvp = useRSVP(court.id);
  // Session ids already RSVP'd from this sheet, so the button can settle
  // into a "You're in" state instead of firing duplicate RSVPs.
  const [joinedSessionIds, setJoinedSessionIds] = useState<string[]>([]);

  const isNow = scrubHour === hours[0];
  const count = isNow ? court.active_count : expectedAt(forecast, scrubHour);
  const session = isNow ? null : sessionAt(forecast, scrubHour);
  const joined = session != null && joinedSessionIds.includes(session.session_id);

  const statusLine = isNow
    ? `${count} playing now`
    : `~${count} expected at ${hourLabel(scrubHour)}${session ? " · run scheduled" : ""}`;

  const imIn = () => {
    if (isNow) {
      // Route lands in a later task — wiring the link now is intentional.
      router.push({ pathname: "/check-in", params: { courtId: court.id } } as unknown as Href);
      return;
    }
    if (!user) {
      router.push(signInHref(pathname) as Href);
      return;
    }
    if (session) {
      rsvp.mutate(
        { sessionId: session.session_id, status: "going" },
        {
          onSuccess: () =>
            setJoinedSessionIds((ids) => [...ids, session.session_id]),
        },
      );
      return;
    }
    router.push({
      pathname: "/court/[id]/plan",
      params: { id: court.id, prefillHour: String(scrubHour) },
    });
  };

  return (
    <View
      style={[
        styles.sheet,
        t.shadows.sheet,
        {
          backgroundColor: t.colors.surface,
          paddingBottom: Math.max(insets.bottom, t.spacing.lg),
        },
      ]}
    >
      <View style={[styles.handle, { backgroundColor: t.colors.chipBorder }]} />
      <View style={styles.header}>
        <Text style={[t.type.displayCondensed, { color: t.colors.textPrimary }]}>Today</Text>
        <Text style={[t.type.caption, styles.headerCaption, { color: t.colors.textMuted }]}>
          {`now → ${hourLabel(hours[hours.length - 1] ?? 22)}`}
        </Text>
        <Text
          style={{
            fontFamily: t.fonts.condensed,
            fontSize: 17,
            textTransform: "uppercase",
            color: t.colors.accent,
          }}
        >
          {isNow ? "Now" : hourLabel(scrubHour)}
        </Text>
      </View>
      <TimeScrubber hours={hours} value={scrubHour} onChange={onScrub} />
      <View
        style={[
          styles.resultCard,
          { backgroundColor: t.colors.background, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.resultInfo}>
          <View style={styles.nameRow}>
            <View
              style={[
                styles.liveDot,
                {
                  backgroundColor:
                    isNow && count > 0 ? t.colors.live : t.colors.quietDot,
                },
              ]}
            />
            <Text style={[t.type.heading, { color: t.colors.textPrimary }]} numberOfLines={1}>
              {court.name}
            </Text>
          </View>
          <Text style={[t.type.caption, { color: t.colors.textSecondary }]} numberOfLines={1}>
            {statusLine}
          </Text>
        </View>
        <Button
          title={joined ? "You're in" : "I'm in"}
          compact
          busy={rsvp.isPending}
          disabled={joined}
          onPress={imIn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 10,
  },
  headerCaption: {
    flex: 1,
    marginLeft: 8,
  },
  resultCard: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    gap: 12,
  },
  resultInfo: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
