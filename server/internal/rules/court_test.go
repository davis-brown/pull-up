package rules_test

import (
	"testing"

	"github.com/davisbrown/pull-up/server/internal/rules"
)

func ptr[T any](v T) *T { return &v }

// -- court verification -----------------------------------------------------

func TestDecideCourtStatus(t *testing.T) {
	cases := []struct {
		name         string
		current      string
		upvotes, net int
		wantStatus   string
		wantChanged  bool
	}{
		{
			name:    "a pending court with enough weighted upvotes verifies",
			current: rules.CourtPending, upvotes: rules.VerifyUpvotes, net: 2,
			wantStatus: rules.CourtVerified, wantChanged: true,
		},
		{
			name:    "one weighted upvote short stays pending",
			current: rules.CourtPending, upvotes: rules.VerifyUpvotes - 1, net: 1,
			wantStatus: rules.CourtPending, wantChanged: false,
		},
		{
			name:    "enough downvotes reject",
			current: rules.CourtPending, upvotes: 0, net: rules.RejectNetVotes,
			wantStatus: rules.CourtRejected, wantChanged: true,
		},
		{
			// A court that turned out to be gone must be removable even after
			// it was verified.
			name:    "a verified court can still be voted down",
			current: rules.CourtVerified, upvotes: 5, net: rules.RejectNetVotes - 1,
			wantStatus: rules.CourtRejected, wantChanged: true,
		},
		{
			// Re-promoting would re-award the submitter.
			name:    "an already-verified court is not re-verified",
			current: rules.CourtVerified, upvotes: 10, net: 10,
			wantStatus: rules.CourtVerified, wantChanged: false,
		},
		{
			name:    "a rejected court is not re-rejected",
			current: rules.CourtRejected, upvotes: 0, net: -10,
			wantStatus: rules.CourtRejected, wantChanged: false,
		},
		{
			// Rejection is evaluated first, so a brigaded court with both heavy
			// up- and downvotes goes down rather than up.
			name:    "rejection wins when both thresholds are met",
			current: rules.CourtPending, upvotes: 10, net: rules.RejectNetVotes,
			wantStatus: rules.CourtRejected, wantChanged: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, changed := rules.DecideCourtStatus(tc.current, tc.upvotes, tc.net)
			if status != tc.wantStatus || changed != tc.wantChanged {
				t.Errorf("DecideCourtStatus(%q, %d, %d) = (%q, %v), want (%q, %v)",
					tc.current, tc.upvotes, tc.net, status, changed, tc.wantStatus, tc.wantChanged)
			}
		})
	}
}

// -- pay-to-play detail -----------------------------------------------------

// normalize is a helper: NormalizeFee takes double pointers so it can rewrite
// the caller's fields in place.
func normalize(fee *bool, amount *int32, currency, note *string, existing *string) (string, *bool, *int32, *string, *string) {
	msg := rules.NormalizeFee(&fee, &amount, &currency, &note, existing)
	return msg, fee, amount, currency, note
}

// The fee implication: stating a price asserts the court charges, so the flag
// follows the amount. This is the rule most likely to be quietly broken by a
// later edit, and it previously had no test at all.
func TestNormalizeFeeAmountImpliesCharged(t *testing.T) {
	msg, fee, _, _, _ := normalize(nil, ptr(int32(500)), ptr("USD"), nil, nil)
	if msg != "" {
		t.Fatalf("NormalizeFee: %s", msg)
	}
	if fee == nil || !*fee {
		t.Errorf("fee = %v, want true: an amount asserts the court charges", fee)
	}
}

// The reverse is never inferred -- it is a contradiction the caller resolves.
func TestNormalizeFeeAmountWithChargedFalseIsRejected(t *testing.T) {
	msg, _, _, _, _ := normalize(ptr(false), ptr(int32(500)), ptr("USD"), nil, nil)
	if msg != "fee_amount_cents cannot be set when fee is false" {
		t.Errorf("message = %q, want the contradiction rejected", msg)
	}
}

// Marking a court free is a legitimate statement and must survive.
func TestNormalizeFeeChargedFalseAloneIsAccepted(t *testing.T) {
	msg, fee, _, _, _ := normalize(ptr(false), nil, nil, nil, nil)
	if msg != "" {
		t.Fatalf("marking a court free was rejected: %s", msg)
	}
	if fee == nil || *fee {
		t.Errorf("fee = %v, want false", fee)
	}
}

func TestNormalizeFeeCanonicalisesCurrency(t *testing.T) {
	msg, _, _, currency, _ := normalize(nil, ptr(int32(1)), ptr("  usd "), nil, nil)
	if msg != "" {
		t.Fatalf("NormalizeFee: %s", msg)
	}
	if *currency != "USD" {
		t.Errorf("currency = %q, want USD", *currency)
	}
}

func TestNormalizeFeeRejectsBadCurrency(t *testing.T) {
	for _, code := range []string{"US", "USDD", "US1", "$$$", ""} {
		if msg, _, _, _, _ := normalize(nil, nil, ptr(code), nil, nil); msg == "" {
			t.Errorf("currency %q was accepted", code)
		}
	}
}

// An amount needs a currency, but a patch may lean on the one already stored.
func TestNormalizeFeeAmountRequiresACurrencyUnlessStored(t *testing.T) {
	if msg, _, _, _, _ := normalize(nil, ptr(int32(500)), nil, nil, nil); msg == "" {
		t.Error("an amount with no currency, on a court with none, was accepted")
	}
	if msg, _, _, _, _ := normalize(nil, ptr(int32(500)), nil, nil, ptr("EUR")); msg != "" {
		t.Errorf("an amount-only patch against a stored currency was rejected: %s", msg)
	}
}

func TestNormalizeFeeAmountBounds(t *testing.T) {
	for _, amount := range []int32{-1, rules.MaxFeeAmountCents + 1} {
		if msg, _, _, _, _ := normalize(nil, ptr(amount), ptr("USD"), nil, nil); msg == "" {
			t.Errorf("amount %d was accepted", amount)
		}
	}
	// The bounds themselves are inclusive.
	for _, amount := range []int32{0, rules.MaxFeeAmountCents} {
		if msg, _, _, _, _ := normalize(nil, ptr(amount), ptr("USD"), nil, nil); msg != "" {
			t.Errorf("amount %d was rejected: %s", amount, msg)
		}
	}
}

// A whitespace-only note is not a note; storing it would render as a blank
// line in the app.
func TestNormalizeFeeBlankNoteBecomesAbsent(t *testing.T) {
	msg, _, _, _, note := normalize(nil, nil, nil, ptr("   "), nil)
	if msg != "" {
		t.Fatalf("NormalizeFee: %s", msg)
	}
	if note != nil {
		t.Errorf("note = %q, want nil", *note)
	}
}

func TestNormalizeFeeNoteIsTrimmedAndBounded(t *testing.T) {
	msg, _, _, _, note := normalize(nil, nil, nil, ptr("  drop-in  "), nil)
	if msg != "" || *note != "drop-in" {
		t.Errorf("note = %v (msg %q), want trimmed", note, msg)
	}

	long := make([]byte, rules.MaxFeeNoteLen+1)
	for i := range long {
		long[i] = 'x'
	}
	if msg, _, _, _, _ := normalize(nil, nil, nil, ptr(string(long)), nil); msg == "" {
		t.Error("an over-long fee note was accepted")
	}
}

// -- attribute edits --------------------------------------------------------

// Re-submitting the value already stored is not an edit. Auditing it would
// bury genuine corrections under no-op traffic.
func TestAttributeDiffIgnoresUnchangedAndUnstated(t *testing.T) {
	var d rules.AttributeDiff
	d.Add("surface", true, false, "asphalt", "asphalt") // stated, unchanged
	d.Add("lighting", false, true, "", "true")          // not in this PATCH

	if got := d.Changes(); len(got) != 0 {
		t.Errorf("Changes() = %+v, want none", got)
	}
}

func TestAttributeDiffRecordsOldAndNew(t *testing.T) {
	var d rules.AttributeDiff
	d.Add("surface", true, true, "asphalt", "concrete")

	got := d.Changes()
	if len(got) != 1 {
		t.Fatalf("Changes() = %+v, want one", got)
	}
	if got[0].Field != "surface" || got[0].OldValue != "asphalt" || got[0].NewValue != "concrete" {
		t.Errorf("change = %+v", got[0])
	}
}

// A previously unknown value audits as an empty old value, which is how "was
// unknown" is recorded.
func TestAttributeRenderingOfUnknownValues(t *testing.T) {
	if rules.StrOf(nil) != "" || rules.BoolOf(nil) != "" || rules.Int16Of(nil) != "" || rules.Int32Of(nil) != "" {
		t.Error("a nil stored value did not render as empty")
	}
	if rules.BoolOf(ptr(true)) != "true" {
		t.Error("a stored bool did not render")
	}
}

// Setting a value where none was stored is a change, not a no-op: both are
// "different from nil" and the comparison must not conflate them.
func TestPointerEqualityTreatsNilAndValueAsDifferent(t *testing.T) {
	if rules.BoolPtrEq(ptr(false), nil) {
		t.Error("false and unknown compared equal")
	}
	if !rules.BoolPtrEq(nil, nil) {
		t.Error("two unknowns compared unequal")
	}
	if !rules.StrPtrEq(ptr("a"), ptr("a")) {
		t.Error("equal strings compared unequal")
	}
	if rules.Int16PtrEq(ptr(int16(1)), ptr(int16(2))) {
		t.Error("different int16s compared equal")
	}
	if rules.Int32PtrEq(ptr(int32(1)), nil) {
		t.Error("a value and unknown compared equal")
	}
}
