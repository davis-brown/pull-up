import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSignInDetour } from "@/components/SignInCta";
import { Button, Card, Chip, ErrorText, Field, Overline } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { useCourtActivity, useRecordGame } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";

// Recording a game: pick who played from the people currently checked in,
// split them into two sides, say who won. The result is a claim about
// other people, so it stays invisible until the losing side confirms it —
// hence the copy below setting that expectation up front.
export function RecordGame({ courtId }: { courtId: string }) {
  const t = useTheme();
  const { user } = useAuth();
  const detour = useSignInDetour();
  const { data: activity } = useCourtActivity(courtId);
  const record = useRecordGame(courtId);

  const [open, setOpen] = useState(false);
  // user_id -> team (0 or 1); absent means "didn't play".
  const [teams, setTeams] = useState<Record<string, number>>({});
  const [winner, setWinner] = useState<number | null>(null);
  const [scoreWin, setScoreWin] = useState("");
  const [scoreLose, setScoreLose] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Everyone currently at the court, deduped — the check-in list can hold
  // several rows for one player across a long session.
  const present = Array.from(
    new Map((activity?.check_ins ?? []).map((c) => [c.user_id, c])).values(),
  );

  const teamA = Object.entries(teams).filter(([, v]) => v === 0).map(([k]) => k);
  const teamB = Object.entries(teams).filter(([, v]) => v === 1).map(([k]) => k);
  const iPlayed = user != null && teams[user.id] !== undefined;
  const canSubmit =
    teamA.length > 0 && teamB.length > 0 && winner != null && iPlayed && !record.isPending;

  const cyclePlayer = (id: string) => {
    setError(null);
    setTeams((prev) => {
      const next = { ...prev };
      // Unassigned -> team 0 -> team 1 -> unassigned.
      if (next[id] === undefined) next[id] = 0;
      else if (next[id] === 0) next[id] = 1;
      else delete next[id];
      return next;
    });
  };

  const reset = () => {
    setTeams({});
    setWinner(null);
    setScoreWin("");
    setScoreLose("");
    setError(null);
  };

  const submit = () => {
    setError(null);
    const hasScore = scoreWin.trim() !== "" || scoreLose.trim() !== "";
    if (hasScore && (scoreWin.trim() === "" || scoreLose.trim() === "")) {
      setError("Enter both scores, or leave both blank.");
      return;
    }
    const win = Number(scoreWin);
    const lose = Number(scoreLose);
    if (hasScore && (!Number.isInteger(win) || !Number.isInteger(lose) || win <= lose)) {
      setError("The winning score has to be the higher one.");
      return;
    }
    record.mutate(
      {
        team_a: teamA,
        team_b: teamB,
        winning_team: winner!,
        ...(hasScore ? { score_win: win, score_lose: lose } : {}),
      },
      {
        onSuccess: () => {
          reset();
          setOpen(false);
        },
        onError: (e) => setError(e.message),
      },
    );
  };

  if (!open) {
    return (
      <Button
        title="Record a game"
        variant="ghost"
        onPress={() => {
          if (!user) return detour();
          setOpen(true);
        }}
      />
    );
  }

  return (
    <Card>
      <Overline>Record a game</Overline>
      {present.length === 0 ? (
        <Text style={[t.type.caption, { color: t.colors.textMuted, marginTop: t.spacing.sm }]}>
          Nobody's checked in right now — games are recorded from the players
          at the court.
        </Text>
      ) : (
        <>
          <Text style={[t.type.caption, { color: t.colors.textSecondary, marginTop: 4 }]}>
            Tap a player to put them on a side. It won't show up anywhere until
            someone on the losing team confirms it.
          </Text>
          <View style={styles.chips}>
            {present.map((p) => {
              const team = teams[p.user_id];
              return (
                <Chip
                  key={p.user_id}
                  label={
                    team === undefined
                      ? p.display_name
                      : `${p.display_name} · ${team === 0 ? "A" : "B"}`
                  }
                  selected={team !== undefined}
                  onPress={() => cyclePlayer(p.user_id)}
                />
              );
            })}
          </View>

          <Text
            style={[
              t.type.label,
              { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.sm },
            ]}
          >
            Who won?
          </Text>
          <View style={styles.chips}>
            <Chip label={`Team A (${teamA.length})`} selected={winner === 0} onPress={() => setWinner(0)} />
            <Chip label={`Team B (${teamB.length})`} selected={winner === 1} onPress={() => setWinner(1)} />
          </View>

          <View style={styles.scoreRow}>
            <View style={styles.scoreField}>
              <Field
                label="Winning score (optional)"
                placeholder="11"
                value={scoreWin}
                onChangeText={setScoreWin}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={styles.scoreField}>
              <Field
                label="Other score"
                placeholder="7"
                value={scoreLose}
                onChangeText={setScoreLose}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          </View>

          {!iPlayed && (teamA.length > 0 || teamB.length > 0) ? (
            <Text style={[t.type.caption, { color: t.colors.textMuted }]}>
              Put yourself on a side — you can only log games you played in.
            </Text>
          ) : null}
          <ErrorText message={error} />
          <Button title="Save game" busy={record.isPending} onPress={submit} disabled={!canSubmit} />
        </>
      )}
      <Pressable
        onPress={() => {
          reset();
          setOpen(false);
        }}
        hitSlop={8}
      >
        <Text style={[t.type.label, { color: t.colors.textMuted, textAlign: "center", paddingVertical: 8 }]}>
          Cancel
        </Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", marginBottom: -8, marginTop: 8 },
  scoreRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  scoreField: { flex: 1 },
});
