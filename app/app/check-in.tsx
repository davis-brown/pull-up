import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/Avatar";
import { AuthGate } from "@/components/AuthGate";
import { QueryError } from "@/components/QueryError";
import { SlideToConfirm } from "@/components/SlideToConfirm";
import { ErrorText } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { loadLastCheckInPrefs, saveLastCheckInPrefs } from "@/lib/checkin-prefs";
import { getErrorMessage } from "@/lib/errors";
import { useCheckIn, useCourt, useCourtActivity } from "@/lib/hooks";
import { getCurrentPosition } from "@/lib/location";
import { parseRouteId, safePathSegment } from "@/lib/routes";
import { darkTheme } from "@/lib/theme";

const PLUS_OPTIONS = [0, 1, 2, 3];
const MAX_AVATARS = 3;
const SUCCESS_DISMISS_MS = 800;
// Base check-in award, mirroring XP_SOURCES ("Check in at a court", +10) in
// lib/levels.ts. Shown as the slide control's reward chip. Deliberately the
// base, not the first-of-day +15: a repeat check-in can earn less, so this
// never over-promises on the common path.
const CHECK_IN_XP = 10;

// Full-screen dark slide-to-check-in modal (spec 3d). Always dark, so it
// resolves theme locally via darkTheme() instead of useTheme() — the
// global theme preference never flips for this screen.
export default function CheckInScreen() {
  const params = useLocalSearchParams();
  const courtId = parseRouteId(params.courtId);
  const via = params.via === "gps" ? "gps" : undefined;
  if (!courtId) {
    return (
      <QueryError
        error={new Error("Invalid court id")}
        title="Invalid check-in link"
        message="Open a court and try checking in again."
      />
    );
  }
  const next = `/check-in?courtId=${safePathSegment(courtId)}${via ? "&via=gps" : ""}`;
  return (
    <AuthGate next={next}>
      <CheckInContent courtId={courtId} via={via} />
    </AuthGate>
  );
}

function CheckInContent({ courtId, via }: { courtId: string; via?: "gps" }) {
  const t = darkTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: court } = useCourt(courtId);
  const { data: activity } = useCourtActivity(courtId);
  const checkIn = useCheckIn(courtId);

  const [plusCount, setPlusCount] = useState(0);
  const [hasBall, setHasBall] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadLastCheckInPrefs().then((prefs) => {
      if (cancelled) return;
      setPlusCount(Math.min(Math.max(prefs.partySize - 1, 0), 3));
      setHasBall(prefs.hasBall);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const checkIns = activity?.check_ins ?? [];
  const heads = activity?.active_count ?? 0;
  const visibleAvatars = checkIns.slice(0, MAX_AVATARS);
  const overflow = checkIns.length - visibleAvatars.length;

  const handleConfirm = () => {
    if (confirming || success) return;
    setError(null);
    setConfirming(true);
    void (async () => {
      let coords: { lat: number; lng: number };
      try {
        coords = await getCurrentPosition();
      } catch (e) {
        setConfirming(false);
        setAttempt((n) => n + 1);
        setError(getErrorMessage(e, "Could not get your location"));
        return;
      }
      const partySize = plusCount + 1;
      checkIn.mutate(
        {
          party_size: partySize,
          has_ball: hasBall,
          lat: coords.lat,
          lng: coords.lng,
        },
        {
          onSuccess: () => {
            void saveLastCheckInPrefs({ partySize, hasBall });
            setSuccess(true);
            setTimeout(() => router.back(), SUCCESS_DISMISS_MS);
          },
          onError: (e) => {
            setConfirming(false);
            setAttempt((n) => n + 1);
            if (e instanceof ApiError && e.status === 422) {
              const raw = Number(e.body.distance_m);
              const meters = Number.isFinite(raw) ? Math.round(raw) : null;
              setError(
                meters != null
                  ? `You need to be at the court to check in — you're about ${meters} m away.`
                  : "You need to be at the court to check in.",
              );
            } else {
              setError(e.message);
            }
          },
        },
      );
    })();
  };

  if (success) {
    return (
      <View
        style={[
          styles.container,
          styles.center,
          { backgroundColor: t.colors.background, paddingBottom: insets.bottom },
        ]}
      >
        <StatusBar style="light" />
        <Ionicons name="checkmark-circle" size={64} color={t.colors.live} />
        <Text
          style={[t.type.hero, styles.successName, { color: t.colors.textPrimary }]}
        >
          {court?.name ?? "Checked in"}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: t.colors.background,
          paddingTop: insets.top + t.spacing.xl,
          paddingBottom: Math.max(insets.bottom, t.spacing.lg),
          paddingHorizontal: t.spacing.xl,
        },
      ]}
    >
      <StatusBar style="light" />

      <View style={styles.liveRow}>
        <View style={[styles.liveDot, { backgroundColor: t.colors.live }]} />
        <Text style={[t.type.overline, { color: t.colors.textMuted }]}>YOU'RE AT</Text>
      </View>
      <Text style={[t.type.hero, { color: t.colors.textPrimary, marginTop: t.spacing.sm }]}>
        {court?.name ?? ""}
      </Text>
      <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.xs }]}>
        {via === "gps" ? "detected by GPS · " : ""}
        {heads} already hooping
      </Text>

      <View style={styles.avatarRow}>
        {visibleAvatars.map((ci, i) => (
          <View
            key={ci.id}
            style={[
              styles.avatarWrap,
              i > 0 && styles.avatarOverlap,
              { borderColor: t.colors.background, backgroundColor: t.colors.background },
            ]}
          >
            <Avatar avatarUrl={null} displayName={ci.display_name} seed={ci.user_id} size={30} />
          </View>
        ))}
        {overflow > 0 && (
          <View
            style={[
              styles.avatarWrap,
              styles.avatarOverlap,
              styles.overflowChip,
              { borderColor: t.colors.background, backgroundColor: t.colors.accent },
            ]}
          >
            <Text
              style={[
                t.type.caption,
                { color: t.colors.onAccent, fontFamily: t.fonts.bodyBold, fontSize: 13 },
              ]}
            >
              +{overflow}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.spacer} />

      <View style={styles.bottomGroup}>
        <View style={styles.bringingRow}>
          <Text style={[t.type.overline, { color: t.colors.textMuted }]}>BRINGING</Text>
          <View style={styles.chipsRow}>
            {PLUS_OPTIONS.map((n) => {
              const selected = plusCount === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setPlusCount(n)}
                  disabled={confirming || success}
                  style={[
                    styles.bringChip,
                    {
                      borderRadius: t.radius.full,
                      backgroundColor: selected ? t.colors.accent : "transparent",
                      borderColor: selected ? t.colors.accent : t.colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      t.type.button,
                      styles.bringChipLabel,
                      // Selected chip is ink text on the electric-accent
                      // background, not onAccent (white) — t.colors.background
                      // is the dark palette's near-black, and this screen is
                      // always dark (darkTheme()).
                      { color: selected ? t.colors.background : t.colors.textMuted },
                    ]}
                  >
                    {n === 0 ? "JUST ME" : `+${n}`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.ballRow}>
          <Text style={[t.type.heading, { color: t.colors.textSecondary }]}>
            Got a ball
          </Text>
          <Switch
            value={hasBall}
            onValueChange={setHasBall}
            disabled={confirming || success}
            trackColor={{ false: t.colors.border, true: t.colors.accent }}
            thumbColor={t.colors.onAccent}
          />
        </View>

        <ErrorText message={error} />

        <SlideToConfirm
          key={attempt}
          label="SLIDE TO CHECK IN"
          xpReward={CHECK_IN_XP}
          onConfirm={handleConfirm}
          disabled={confirming || success}
        />

        <Text style={[t.type.caption, styles.footnote, { color: t.colors.textFootnote }]}>
          check-ins expire after 2 hours, or check out anytime
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  successName: {
    marginTop: 20,
    textAlign: "center",
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  avatarRow: {
    flexDirection: "row",
    marginTop: 22,
  },
  avatarWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarOverlap: {
    marginLeft: -10,
  },
  overflowChip: {
    alignItems: "center",
    justifyContent: "center",
  },
  spacer: {
    flex: 1,
  },
  bottomGroup: {
    gap: 18,
  },
  bringingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipsRow: {
    flexDirection: "row",
    gap: 8,
  },
  bringChip: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  bringChipLabel: {
    fontSize: 15,
  },
  ballRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  footnote: {
    textAlign: "center",
  },
});
