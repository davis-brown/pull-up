package rules

import (
	"fmt"
	"strings"
)

// -- court verification -----------------------------------------------------

// Court lifecycle states.
const (
	CourtPending  = "pending"
	CourtVerified = "verified"
	CourtRejected = "rejected"
)

const (
	// VerifyUpvotes promotes a pending court to verified. Reputation-weighted:
	// a vote counts 1-3x depending on the voter's reputation tier.
	VerifyUpvotes = 2
	// RejectNetVotes hides a court (also weighted).
	RejectNetVotes = -3
)

// DecideCourtStatus applies the verification thresholds to a fresh weighted
// tally and reports the court's resulting status, plus whether it changed.
//
// Rejection is checked first and applies from any status, so a court that was
// verified can still be voted down. Promotion only lifts a pending court --
// re-promoting a verified one would re-award its submitter.
func DecideCourtStatus(current string, weightedUpvotes, netWeighted int) (status string, changed bool) {
	switch {
	case netWeighted <= RejectNetVotes && current != CourtRejected:
		return CourtRejected, true
	case weightedUpvotes >= VerifyUpvotes && current == CourtPending:
		return CourtVerified, true
	default:
		return current, false
	}
}

// -- pay-to-play detail -----------------------------------------------------

const (
	// MaxFeeAmountCents mirrors the courts_fee_amount_cents CHECK, so an
	// out-of-range price is a 400 rather than a constraint violation turned 500.
	MaxFeeAmountCents = 1_000_000
	// MaxFeeNoteLen mirrors the fee_note CHECK.
	MaxFeeNoteLen = 80
)

// NormalizeFee validates the pay-to-play triple in place and returns a client
// error message, or "" when the input is acceptable. Create and patch both run
// it, so both reject the same shapes the courts table would.
//
// It also applies the fee implication: a price is itself an assertion that the
// court charges, so an amount with no explicit fee flag sets fee=true. The
// reverse is never inferred — fee=false with an amount is a contradiction the
// caller has to resolve.
//
// existingCurrency is the court's stored fee_currency (nil on create). A patch
// that sets only an amount is valid when the court already has a currency,
// since the UPDATE coalesces the unset column and the CHECK still holds.
func NormalizeFee(fee **bool, amount **int32, currency **string, note **string, existingCurrency *string) string {
	if *note != nil {
		trimmed := strings.TrimSpace(**note)
		if len(trimmed) > MaxFeeNoteLen {
			return fmt.Sprintf("fee_note must be %d characters or fewer", MaxFeeNoteLen)
		}
		if trimmed == "" {
			*note = nil
		} else {
			*note = &trimmed
		}
	}
	if *currency != nil {
		code := strings.ToUpper(strings.TrimSpace(**currency))
		if !isCurrencyCode(code) {
			return "fee_currency must be a 3-letter ISO 4217 code"
		}
		*currency = &code
	}
	if *amount != nil {
		if **amount < 0 || **amount > MaxFeeAmountCents {
			return fmt.Sprintf("fee_amount_cents must be between 0 and %d", MaxFeeAmountCents)
		}
		if *currency == nil && existingCurrency == nil {
			return "fee_currency is required when fee_amount_cents is set"
		}
		if *fee != nil && !**fee {
			return "fee_amount_cents cannot be set when fee is false"
		}
		if *fee == nil {
			charged := true
			*fee = &charged
		}
	}
	return ""
}

func isCurrencyCode(v string) bool {
	if len(v) != 3 {
		return false
	}
	for _, r := range v {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// -- attribute edits --------------------------------------------------------

// AttributeChange is one audited field edit.
type AttributeChange struct {
	Field    string
	OldValue string
	NewValue string
}

// AttributeDiff reports which stated fields actually differ from the court's
// current values.
//
// Only real changes are audited: re-submitting the value already stored is not
// an edit, and logging it would bury genuine corrections under no-op traffic.
// Each entry is (field, old, new, stated) — stated separates "not in this
// PATCH" from "explicitly set to nothing".
type AttributeDiff struct {
	changes []AttributeChange
}

// Add records a field when it was stated and differs from the stored value.
func (d *AttributeDiff) Add(field string, stated, differs bool, oldVal, newVal string) {
	if stated && differs {
		d.changes = append(d.changes, AttributeChange{Field: field, OldValue: oldVal, NewValue: newVal})
	}
}

// Changes are the edits worth auditing.
func (d *AttributeDiff) Changes() []AttributeChange { return d.changes }

// A nil stored value renders as the empty string in the audit log, which is
// how "was unknown" is recorded.

func StrOf(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func BoolOf(v *bool) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(*v)
}

func Int16Of(v *int16) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(*v)
}

func Int32Of(v *int32) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(*v)
}

// Pointer equality where two nils are equal and a nil never equals a value.

func StrPtrEq(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func BoolPtrEq(a, b *bool) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func Int16PtrEq(a, b *int16) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func Int32PtrEq(a, b *int32) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
