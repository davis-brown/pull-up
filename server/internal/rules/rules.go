// Package rules holds the business rules that are worth testing on their own.
//
// It exists for one reason: these decisions used to be written inline inside
// handlers, tangled with a *Server, a ResponseWriter and a live database, so
// the only way to exercise them was to boot Postgres and drive HTTP. Pulling
// each out as a plain function makes it testable in microseconds and makes the
// rule readable without reading the handler around it.
//
// It is deliberately NOT a layer. There are no interfaces, no repositories and
// no value objects; everything takes and returns ordinary Go types. Handlers
// call in, get an answer, and do the I/O themselves.
//
// A rule belongs here when getting it wrong would be a bug a user notices and
// a test could have caught. Plumbing does not belong here.
package rules

import "time"

// -- refresh token rotation -------------------------------------------------

// RefreshReplayGrace separates a benign concurrent replay from a stolen token.
//
// Two requests from one client can legitimately present the same refresh token
// at once -- an app resuming while a background fetch is in flight. Past this
// window, a second presentation of an already-rotated token is treated as
// theft.
const RefreshReplayGrace = 5 * time.Second

// RefreshDecision is what to do with a presented refresh token.
type RefreshDecision int

const (
	// RefreshRotate issues a new token pair and revokes the presented one.
	RefreshRotate RefreshDecision = iota
	// RefreshExpired means the token is past its lifetime.
	RefreshExpired
	// RefreshReplayWithinGrace is a probable concurrent replay: refuse, but
	// leave the family alone so the legitimate request's rotated token stays
	// valid.
	RefreshReplayWithinGrace
	// RefreshReplayRevokeFamily is a probable theft: refuse and revoke every
	// token in the family, forcing a fresh login on all devices.
	RefreshReplayRevokeFamily
)

// DecideRefresh applies the rotation rules to a presented token.
//
// Order matters. Expiry is checked BEFORE reuse so that an expired,
// previously-rotated token is inert: without that, anyone holding an old
// leaked token could present it to force-revoke the family and log the real
// user out of every device.
func DecideRefresh(expiresAt time.Time, revokedAt *time.Time, now time.Time) RefreshDecision {
	if !now.Before(expiresAt) {
		return RefreshExpired
	}
	if revokedAt != nil {
		if now.Sub(*revokedAt) > RefreshReplayGrace {
			return RefreshReplayRevokeFamily
		}
		return RefreshReplayWithinGrace
	}
	return RefreshRotate
}

// CanLogoutFamily reports whether a presented token may revoke its family.
//
// Only the current, unexpired token may. Otherwise an old leaked token becomes
// a forced-logout primitive against the account it came from.
func CanLogoutFamily(expiresAt time.Time, revokedAt *time.Time, now time.Time) bool {
	return revokedAt == nil && now.Before(expiresAt)
}

// -- XP levelling -----------------------------------------------------------

// CrossedLevel reports the level a player reached if an award of `awarded`
// points took them over a boundary, and whether it did at all.
//
// This is what decides whether a level-up push fires, so it must trigger only
// on the award that actually crosses -- not on every award made while the
// player happens to sit above the threshold. levelFor is the caller's level
// curve, passed in so this stays independent of it.
func CrossedLevel(totalXPAfter, awarded int, levelFor func(int) int) (int, bool) {
	if awarded <= 0 {
		return 0, false
	}
	before := levelFor(totalXPAfter - awarded)
	after := levelFor(totalXPAfter)
	if after <= before {
		return 0, false
	}
	return after, true
}
