package auth

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func testAppleKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

func TestAppleTokenExchangeAndRevocation(t *testing.T) {
	signingKey, signingPEM := testAppleKey(t)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if r.Form.Get("client_id") != "com.example.app" {
			t.Error("missing Apple client id")
		}
		var claims jwt.RegisteredClaims
		secret, err := jwt.ParseWithClaims(r.Form.Get("client_secret"), &claims, func(*jwt.Token) (any, error) { return &signingKey.PublicKey, nil },
			jwt.WithValidMethods([]string{"ES256"}), jwt.WithIssuer("TEAM123"), jwt.WithSubject("com.example.app"), jwt.WithAudience("https://appleid.apple.com"), jwt.WithExpirationRequired())
		if err != nil || secret.Header["kid"] != "KEY123" {
			t.Errorf("invalid client secret: %v", err)
		}
		switch r.URL.Path {
		case "/auth/token":
			if r.Form.Get("code") != "one-time-code" || r.Form.Get("grant_type") != "authorization_code" {
				t.Error("invalid exchange")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"refresh_token": "private-provider-token", "id_token": "fresh-identity"})
		case "/auth/revoke":
			if r.Form.Get("token") != "private-provider-token" || r.Form.Get("token_type_hint") != "refresh_token" {
				t.Error("invalid revocation")
			}
		default:
			t.Error("unexpected endpoint")
		}
	}))
	defer upstream.Close()
	a := NewAppleTokens("com.example.app", "TEAM123", "KEY123", signingPEM, strings.Repeat("k", 32))
	a.endpoint = upstream.URL
	encrypted, identity, err := a.Exchange(context.Background(), "one-time-code")
	if err != nil || identity != "fresh-identity" {
		t.Fatalf("exchange: identity %q err %v", identity, err)
	}
	if bytes.Contains(encrypted, []byte("private-provider-token")) {
		t.Fatal("provider token stored in plaintext")
	}
	if err := a.Revoke(context.Background(), encrypted); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	encrypted[len(encrypted)-1] ^= 1
	if err := a.Revoke(context.Background(), encrypted); err == nil {
		t.Fatal("accepted altered ciphertext")
	}
	if calls != 2 {
		t.Fatalf("calls %d, want 2", calls)
	}
}

func TestAppleTokensDoNotLeakErrorBodies(t *testing.T) {
	_, signingPEM := testAppleKey(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = w.Write([]byte("sensitive-response-body"))
	}))
	defer upstream.Close()
	a := NewAppleTokens("client", "team", "kid", signingPEM, strings.Repeat("k", 32))
	a.endpoint = upstream.URL
	_, _, err := a.Exchange(context.Background(), "code")
	if err == nil || strings.Contains(err.Error(), "sensitive-response-body") {
		t.Fatalf("unexpected error: %v", err)
	}
	if NewAppleTokens("client", "team", "kid", signingPEM, "short").Enabled() {
		t.Fatal("accepted short encryption key")
	}
	if NewAppleTokens("client", "team", "kid", "not a key", strings.Repeat("k", 32)).Enabled() {
		t.Fatal("accepted invalid signing key")
	}
	if _, _, err := a.Exchange(context.Background(), ""); err == nil {
		t.Fatal("accepted missing code")
	}
}
