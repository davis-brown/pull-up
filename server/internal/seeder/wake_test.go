package seeder

import (
	"testing"
	"time"
)

// signal must never block a request handler, whatever the worker is doing.
// Request calls it while serving a user's map viewport, so a full buffer has
// to be dropped rather than waited on.
func TestSignalDoesNotBlockWhenBufferFull(t *testing.T) {
	s := &Seeder{wake: make(chan struct{}, 1)}

	done := make(chan struct{})
	go func() {
		for range 100 {
			s.signal()
		}
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("signal blocked when the wake buffer was already full")
	}

	// A burst coalesces: Run only needs to know that work exists, not how
	// many times it was enqueued.
	if got := len(s.wake); got != 1 {
		t.Fatalf("wake buffer = %d, want 1 (signals should coalesce)", got)
	}
}

// A zero-value Seeder (one built without New) must not panic on signal — the
// nil check is what keeps Request safe in tests and any future constructor.
func TestSignalOnNilChannelIsNoop(t *testing.T) {
	s := &Seeder{}
	s.signal()
}

// Run selects on wake, so a signal sent before Run parks is not lost: the
// buffered slot holds it until Run reaches the select.
func TestSignalBeforeRunIsRetained(t *testing.T) {
	s := &Seeder{wake: make(chan struct{}, 1)}
	s.signal()

	select {
	case <-s.wake:
	default:
		t.Fatal("signal sent before Run parked was dropped")
	}
}
