import { StyleSheet, Text, View } from "react-native";
import { RecordGame } from "@/components/court/RecordGame";
import { Button, Card, ErrorText, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useConfirmGame, useCourtGames, usePendingGames } from "@/lib/hooks";
import { relativeSince } from "@/lib/relative-time";
import { useTheme } from "@/lib/theme";
import type { CourtGame } from "@/lib/types";

function teamNames(game: CourtGame, team: number): string {
  const names = game.players.filter((p) => p.team === team).map((p) => p.display_name);
  return names.length > 0 ? names.join(", ") : "—";
}

function scoreLabel(game: CourtGame): string {
  if (game.score_win == null || game.score_lose == null) return "";
  return `  ${game.score_win}–${game.score_lose}`;
}

// Recent confirmed games at a court, the record-a-game flow, and any
// results waiting on this player's word. Confirmed games only: an
// unconfirmed result is a claim, and claims about other people don't get
// published (phase 18).
export function CourtGames({ courtId }: { courtId: string }) {
  const t = useTheme();
  const { user } = useAuth();
  const { data: games } = useCourtGames(courtId);
  const { data: pending } = usePendingGames();
  const confirm = useConfirmGame();

  // Only the ones for this court — the pending query is account-wide.
  const pendingHere = (pending ?? []).filter((g) => g.court_id === courtId);

  return (
    <Card>
      <Overline>Games</Overline>

      {user && pendingHere.length > 0 ? (
        <View style={{ marginTop: t.spacing.sm }}>
          {pendingHere.map((g) => (
            <View
              key={g.id}
              style={[
                styles.pendingRow,
                { borderColor: t.colors.accent, borderRadius: t.radius.md },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]}>
                  {g.recorded_by_name} logged a game you lost
                  {g.score_win != null && g.score_lose != null
                    ? `, ${g.score_win}–${g.score_lose}`
                    : ""}
                </Text>
                <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
                  Confirm it and it counts for everyone who played.
                </Text>
              </View>
              <Button
                title="Confirm"
                variant="secondary"
                busy={confirm.isPending}
                onPress={() => confirm.mutate(g.id)}
              />
            </View>
          ))}
          <ErrorText message={confirm.error instanceof Error ? confirm.error.message : null} />
        </View>
      ) : null}

      {(games?.length ?? 0) > 0 ? (
        games!.map((g) => (
          <View key={g.id} style={[styles.gameRow, { borderTopColor: t.colors.border }]}>
            <Text style={[t.type.bodyMedium, { color: t.colors.textPrimary }]} numberOfLines={2}>
              {teamNames(g, g.winning_team)}
              <Text style={{ color: t.colors.textSecondary }}> beat </Text>
              {teamNames(g, g.winning_team === 0 ? 1 : 0)}
            </Text>
            <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 2 }]}>
              {relativeSince(g.played_at)}
              {scoreLabel(g)}
            </Text>
          </View>
        ))
      ) : (
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          No games logged here yet.
        </Text>
      )}

      <RecordGame courtId={courtId} />
    </Card>
  );
}

const styles = StyleSheet.create({
  gameRow: {
    paddingVertical: 10,
    marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
  },
});
