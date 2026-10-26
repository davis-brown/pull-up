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

func TestAppleEventsAndRelayEmails(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{"kty": "RSA", "kid": "k1", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())}}})
	}))
	defer jwks.Close()
	v := &OAuthVerifier{providers: map[string]providerConfig{"apple": {jwksURL: jwks.URL, issuers: []string{"https://appleid.apple.com"}, audiences: []string{"client"}}}, jwks: map[string]keyfunc.Keyfunc{}}
	sign := func(claims jwt.MapClaims) string {
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = "k1"
		signed, err := tok.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	event := jwt.MapClaims{"iss": "https://appleid.apple.com", "aud": "client", "iat": time.Now().Unix(), "events": `{"type":"consent-revoked","sub":"subject","event_time":1700000000000}`}
	got, err := v.VerifyAppleEvent(context.Background(), sign(event))
	if err != nil || got.Subject != "subject" || got.Type != "consent-revoked" {
		t.Fatalf("valid event rejected: %+v %v", got, err)
	}
	event["aud"] = "unrelated-client"
	if _, err := v.VerifyAppleEvent(context.Background(), sign(event)); err == nil {
		t.Fatal("accepted wrong event audience")
	}
	event["aud"] = "client"
	event["iss"] = "https://attacker.example"
	if _, err := v.VerifyAppleEvent(context.Background(), sign(event)); err == nil {
		t.Fatal("accepted wrong issuer")
	}
	for _, email := range []string{"hidden@privaterelay.appleid.com", "hidden@private.icloud.com"} {
		claims := jwt.MapClaims{"iss": "https://appleid.apple.com", "aud": "client", "sub": "subject", "exp": time.Now().Add(time.Hour).Unix(), "email": email, "email_verified": "true"}
		identity, err := v.Verify(context.Background(), "apple", sign(claims))
		if err != nil || identity.Email != email {
			t.Fatalf("relay rejected: %s %v", email, err)
		}
	}
}
