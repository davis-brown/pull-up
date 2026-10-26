package api_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/davisbrown/pull-up/server/internal/config"
)

func TestAppleNotifications(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kty": "RSA", "kid": "k1", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	}))
	defer jwks.Close()
	ts, st := newTestServerWith(t, func(cfg *config.Config) {
		cfg.AppleAudiences = "com.example.app"
		cfg.AppleKeysURL = jwks.URL
	})
	ctx := context.Background()
	user := registerUser(t, ts, "apple-events@test.local", "Apple Events")
	if _, err := st.Pool.Exec(ctx, `UPDATE users SET auth_provider='apple', oauth_subject='apple-sub' WHERE id=$1`, user.User.ID); err != nil {
		t.Fatal(err)
	}
	notify := func(eventType string, eventTime int64) int {
		t.Helper()
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": "https://appleid.apple.com", "aud": "com.example.app", "iat": time.Now().Unix(),
			"events": fmt.Sprintf(`{"type":%q,"sub":"apple-sub","event_time":%d}`, eventType, eventTime),
		})
		tok.Header["kid"] = "k1"
		payload, err := tok.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		resp := doJSON(t, ts, http.MethodPost, "/auth/apple/notifications", "", map[string]string{"payload": payload})
		resp.Body.Close()
		return resp.StatusCode
	}
	forwarding := func() bool {
		t.Helper()
		var on bool
		if err := st.Pool.QueryRow(ctx, `SELECT apple_email_forwarding FROM users WHERE id=$1`, user.User.ID).Scan(&on); err != nil {
			t.Fatal(err)
		}
		return on
	}

	resp := doJSON(t, ts, http.MethodPost, "/auth/apple/notifications", "", map[string]string{"payload": "not-a-jwt"})
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unsigned notification: %d", resp.StatusCode)
	}
	if code := notify("email-disabled", 2000); code != http.StatusOK || forwarding() {
		t.Fatalf("email-disabled: %d forwarding=%v", code, forwarding())
	}
	// An older event delivered late must not undo a newer one.
	if code := notify("email-enabled", 1000); code != http.StatusOK || forwarding() {
		t.Fatalf("out-of-order email-enabled applied: %d forwarding=%v", code, forwarding())
	}
	if code := notify("consent-revoked", 3000); code != http.StatusOK {
		t.Fatalf("consent-revoked: %d", code)
	}
	var live int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM refresh_tokens WHERE user_id=$1 AND revoked_at IS NULL`, user.User.ID).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 0 {
		t.Fatalf("%d refresh tokens survived consent revocation", live)
	}
	if code := notify("account-deleted", 4000); code != http.StatusNoContent {
		t.Fatalf("account-deleted: %d", code)
	}
	var users int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE id=$1`, user.User.ID).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 0 {
		t.Fatal("account survived Apple account-deleted event")
	}
}
