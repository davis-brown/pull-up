package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

// A token Expo reports as DeviceNotRegistered is deleted after the send;
// the user's other, live token survives.
func TestPushPrunesUnregisteredTokens(t *testing.T) {
	const live, gone = "ExponentPushToken[live]", "ExponentPushToken[gone]"
	expo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// ListUserPushTokens has no ORDER BY, so answer per token rather
		// than assuming which comes first.
		var req struct {
			To []string `json:"to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode push request: %v", err)
		}
		w.Write([]byte(`{"data":[`))
		for i, tok := range req.To {
			if i > 0 {
				w.Write([]byte(","))
			}
			if tok == gone {
				w.Write([]byte(`{"status":"error","details":{"error":"DeviceNotRegistered"}}`))
			} else {
				w.Write([]byte(`{"status":"ok","id":"x"}`))
			}
		}
		w.Write([]byte(`]}`))
	}))
	defer expo.Close()
	t.Setenv("EXPO_PUSH_URL", expo.URL)

	ts, st := newTestServer(t)
	a := registerUser(t, ts, "prune-a@test.local", "A")
	b := registerUser(t, ts, "prune-b@test.local", "B")
	for _, tok := range []string{live, gone} {
		resp := doJSON(t, ts, http.MethodPost, "/me/push-token", b.AccessToken, map[string]string{"token": tok})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("push token %s: status %d", tok, resp.StatusCode)
		}
		resp.Body.Close()
	}

	// A follow request to a private account is the simplest push trigger.
	doJSON(t, ts, http.MethodPatch, "/me", b.AccessToken, map[string]any{"is_private": true}).Body.Close()
	doJSON(t, ts, http.MethodPut, "/users/"+b.User.ID+"/follow", a.AccessToken, nil).Body.Close()

	bID := uuid.MustParse(b.User.ID)
	var tokens []string
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		var err error
		tokens, err = st.Queries.ListUserPushTokens(context.Background(), bID)
		if err != nil {
			t.Fatalf("list tokens: %v", err)
		}
		if len(tokens) == 1 {
			break
		}
	}
	if !slices.Equal(tokens, []string{live}) {
		t.Fatalf("tokens = %v, want [%s]", tokens, live)
	}
}
