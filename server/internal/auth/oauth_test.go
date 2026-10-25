package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// An unverified provider email must not become the account's email, or a
// stranger could claim someone else's address before they sign up.
func TestVerifyDropsUnverifiedEmail(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "kid": "k1", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	defer jwks.Close()

	v := &OAuthVerifier{
		providers: map[string]providerConfig{"google": {
			jwksURL: jwks.URL, issuers: []string{"https://accounts.google.com"}, audiences: []string{"client"},
		}},
		jwks: map[string]keyfunc.Keyfunc{},
	}
	sign := func(verified any) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
			"iss": "https://accounts.google.com", "aud": "client", "sub": "s1",
			"exp": time.Now().Add(time.Hour).Unix(), "email": "Victim@Example.com", "email_verified": verified,
		})
		tok.Header["kid"] = "k1"
		signed, err := tok.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}

	for _, tc := range []struct {
		verified any
		want     string
	}{
		{true, "victim@example.com"},
		{"true", "victim@example.com"},
		{false, ""},
		{nil, ""},
	} {
		id, err := v.Verify(context.Background(), "google", sign(tc.verified))
		if err != nil {
			t.Fatalf("verify (email_verified=%v): %v", tc.verified, err)
		}
		if id.Email != tc.want {
			t.Errorf("email_verified=%v: email = %q, want %q", tc.verified, id.Email, tc.want)
		}
	}
}
