package rules

import "time"

// -- badges -----------------------------------------------------------------

// BadgeState is a badge the player has already been granted.
type BadgeState struct {
	EarnedAt time.Time
	Seen     bool
}

// ReconcileBadges decides what to persist and what to celebrate, given the
// badges a player currently qualifies for and what has already been recorded.
//
// `earned` must be in the fixed badge order, so the returned lists are too --
// the celebration sequence has to be deterministic rather than map order.
//
// `baseline` is the first-ever reconciliation for a player. It records
// everything already earned as ALREADY SEEN, so a long-standing player is not
// suddenly shown six badges they won months ago; only badges earned after that
// baseline count as new.
func ReconcileBadges(earned []string, known map[string]BadgeState, baseline bool) (toRecord, unseen []string) {
	toRecord = make([]string, 0, len(earned))
	for _, slug := range earned {
		if _, ok := known[slug]; !ok {
			toRecord = append(toRecord, slug)
		}
	}

	if baseline {
		// Everything recorded in the baseline pass counts as already seen.
		return toRecord, []string{}
	}

	unseen = make([]string, 0, len(earned))
	for _, slug := range earned {
		state, ok := known[slug]
		if !ok || !state.Seen {
			unseen = append(unseen, slug)
		}
	}
	return toRecord, unseen
}

// -- game results -----------------------------------------------------------

// MaxGameScore bounds a reported score.
const MaxGameScore = 200

// ValidateGameScore checks a reported score, returning a client error message
// or "" when acceptable.
//
// A game with no score at all is fine -- most pickup games are not counted.
// A partial or self-contradicting one is rejected rather than stored, because
// a half-recorded result is worse than none.
func ValidateGameScore(scoreWin, scoreLose *int) string {
	if scoreWin == nil && scoreLose == nil {
		return ""
	}
	if scoreWin == nil || scoreLose == nil {
		return "give both score_win and score_lose, or neither"
	}
	if *scoreWin < 0 || *scoreWin > MaxGameScore || *scoreLose < 0 || *scoreLose > MaxGameScore {
		return "scores must be between 0 and 200"
	}
	// A tie is not a result: the winning team is recorded separately, so equal
	// scores would contradict it.
	if *scoreWin <= *scoreLose {
		return "the winning score must be higher"
	}
	return ""
}

// -- profile privacy --------------------------------------------------------

// HidesActivity reports whether a viewer must be shown a private account's
// aggregates as zero.
//
// Level hides with the rest: reporting 0 would read as a real "Level 1 Rookie"
// rather than as "not shown", which is why the caller nulls it instead.
func HidesActivity(isPrivate, isSelf, isFollowing bool) bool {
	return isPrivate && !isSelf && !isFollowing
}

// CanListConnections reports whether a viewer may see who follows a player.
// A private account's follower list is as sensitive as its activity.
func CanListConnections(isPrivate, isSelf, isFollowing bool) bool {
	return isSelf || !isPrivate || isFollowing
}
