package auth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAccessTokenRoundTrip(t *testing.T) {
	issuer := NewIssuer([]byte("test-secret"), 15*time.Minute)
	uid := uuid.New()

	token, err := issuer.IssueAccessToken(uid, time.Now())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	got, err := issuer.VerifyAccessToken(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if got != uid {
		t.Errorf("got user %s, want %s", got, uid)
	}
}

func TestExpiredAccessTokenRejected(t *testing.T) {
	issuer := NewIssuer([]byte("test-secret"), 15*time.Minute)
	token, err := issuer.IssueAccessToken(uuid.New(), time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := issuer.VerifyAccessToken(token); err == nil {
		t.Error("expected expired token to be rejected")
	}
}

func TestWrongSecretRejected(t *testing.T) {
	issuer := NewIssuer([]byte("secret-a"), 15*time.Minute)
	token, err := issuer.IssueAccessToken(uuid.New(), time.Now())
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	other := NewIssuer([]byte("secret-b"), 15*time.Minute)
	if _, err := other.VerifyAccessToken(token); err == nil {
		t.Error("expected token signed with different secret to be rejected")
	}
}

func TestGarbageTokenRejected(t *testing.T) {
	issuer := NewIssuer([]byte("test-secret"), 15*time.Minute)
	for _, tok := range []string{"", "not-a-jwt", "a.b.c"} {
		if _, err := issuer.VerifyAccessToken(tok); err == nil {
			t.Errorf("expected %q to be rejected", tok)
		}
	}
}

func TestRefreshTokenHashing(t *testing.T) {
	token, hash, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("new refresh token: %v", err)
	}
	if token == "" || hash == "" {
		t.Fatal("empty token or hash")
	}
	if token == hash {
		t.Error("token must not equal its hash")
	}
	if HashRefreshToken(token) != hash {
		t.Error("hash mismatch on re-hash")
	}
	// Distinct tokens each time.
	token2, hash2, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("new refresh token: %v", err)
	}
	if token2 == token || hash2 == hash {
		t.Error("expected unique tokens")
	}
}
