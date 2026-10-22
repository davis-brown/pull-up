package push

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

// expoStub answers like Expo: one ticket per token, in order, marking the
// tokens in gone as DeviceNotRegistered.
func expoStub(t *testing.T, gone map[string]bool) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m message
		if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
			t.Errorf("decode request: %v", err)
		}
		tickets := make([]map[string]any, len(m.To))
		for i, tok := range m.To {
			if gone[tok] {
				tickets[i] = map[string]any{
					"status":  "error",
					"message": tok + " is not a registered push notification recipient",
					"details": map[string]string{"error": "DeviceNotRegistered"},
				}
			} else {
				tickets[i] = map[string]any{"status": "ok", "id": "ticket-" + tok}
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": tickets})
	}))
	t.Cleanup(srv.Close)
	t.Setenv("EXPO_PUSH_URL", srv.URL)
	return srv
}

func TestSendReportsDeadTokensAcrossChunks(t *testing.T) {
	var tokens []string
	gone := map[string]bool{}
	for i := range 250 {
		tok := fmt.Sprintf("ExponentPushToken[%d]", i)
		tokens = append(tokens, tok)
		if i%60 == 0 {
			gone[tok] = true
		}
	}
	expoStub(t, gone)

	dead, err := Send(context.Background(), tokens, "t", "b", nil)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	want := []string{"ExponentPushToken[0]", "ExponentPushToken[60]", "ExponentPushToken[120]", "ExponentPushToken[180]", "ExponentPushToken[240]"}
	if !slices.Equal(dead, want) {
		t.Fatalf("dead = %v, want %v", dead, want)
	}
}

func TestSendIgnoresOtherTicketErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":[{"status":"error","details":{"error":"MessageRateExceeded"}}]}`))
	}))
	defer srv.Close()
	t.Setenv("EXPO_PUSH_URL", srv.URL)

	dead, err := Send(context.Background(), []string{"a"}, "t", "b", nil)
	if err != nil || len(dead) != 0 {
		t.Fatalf("dead = %v, err = %v; want none", dead, err)
	}
}

func TestSendToleratesUnexpectedBodies(t *testing.T) {
	for name, body := range map[string]string{
		"empty":          "",
		"not json":       "ok",
		"ticket count":   `{"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}`,
		"no data member": `{"errors":[]}`,
	} {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(body))
			}))
			defer srv.Close()
			t.Setenv("EXPO_PUSH_URL", srv.URL)

			// Two tokens against one ticket: a mismatch must not guess.
			dead, err := Send(context.Background(), []string{"a", "b"}, "t", "b", nil)
			if err != nil || len(dead) != 0 {
				t.Fatalf("dead = %v, err = %v; want none", dead, err)
			}
		})
	}
}

func TestSendReturnsHTTPErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "too many requests", http.StatusTooManyRequests)
	}))
	defer srv.Close()
	t.Setenv("EXPO_PUSH_URL", srv.URL)

	dead, err := Send(context.Background(), []string{"a"}, "t", "b", nil)
	if err == nil || !strings.Contains(err.Error(), "429") {
		t.Fatalf("err = %v, want a 429 error", err)
	}
	if len(dead) != 0 {
		t.Fatalf("dead = %v, want none", dead)
	}
}
