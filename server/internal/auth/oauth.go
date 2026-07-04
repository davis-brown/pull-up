package auth

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// OAuthIdentity is the verified identity extracted from a provider ID token.
type OAuthIdentity struct {
	Provider string // "google" | "apple"
	Subject  string
	Email    string
	Name     string
}

type providerConfig struct {
	jwksURL   string
	issuers   []string
	audiences []string
}

// OAuthVerifier validates Google / Sign-in-with-Apple identity tokens against
// the providers' published JWKS. A provider with no configured audiences is
// disabled.
type OAuthVerifier struct {
	providers map[string]providerConfig

	mu    sync.Mutex
	jwks  map[string]keyfunc.Keyfunc
}

// NewOAuthVerifier configures providers from comma-separated audience lists
// (Google OAuth client IDs; the iOS bundle id for Apple). Empty = disabled.
func NewOAuthVerifier(googleClientIDs, appleAudiences string) *OAuthVerifier {
	v := &OAuthVerifier{
		providers: map[string]providerConfig{},
		jwks:      map[string]keyfunc.Keyfunc{},
	}
	if auds := splitList(googleClientIDs); len(auds) > 0 {
		v.providers["google"] = providerConfig{
			jwksURL:   "https://www.googleapis.com/oauth2/v3/certs",
			issuers:   []string{"https://accounts.google.com", "accounts.google.com"},
			audiences: auds,
		}
	}
	if auds := splitList(appleAudiences); len(auds) > 0 {
		v.providers["apple"] = providerConfig{
			jwksURL:   "https://appleid.apple.com/auth/keys",
			issuers:   []string{"https://appleid.apple.com"},
			audiences: auds,
		}
	}
	return v
}

func (v *OAuthVerifier) Enabled(provider string) bool {
	_, ok := v.providers[provider]
	return ok
}

func (v *OAuthVerifier) Verify(ctx context.Context, provider, idToken string) (*OAuthIdentity, error) {
	cfg, ok := v.providers[provider]
	if !ok {
		return nil, fmt.Errorf("provider %q is not configured", provider)
	}
	kf, err := v.keyfuncFor(ctx, provider, cfg.jwksURL)
	if err != nil {
		return nil, err
	}

	claims := struct {
		jwt.RegisteredClaims
		Email string `json:"email"`
		Name  string `json:"name"`
	}{}
	token, err := jwt.ParseWithClaims(idToken, &claims, kf.Keyfunc,
		jwt.WithExpirationRequired(),
		jwt.WithValidMethods([]string{"RS256", "ES256"}),
	)
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	if !slices.Contains(cfg.issuers, claims.Issuer) {
		return nil, ErrInvalidToken
	}
	audOK := false
	for _, aud := range claims.Audience {
		if slices.Contains(cfg.audiences, aud) {
			audOK = true
			break
		}
	}
	if !audOK {
		return nil, ErrInvalidToken
	}
	if claims.Subject == "" {
		return nil, ErrInvalidToken
	}
	return &OAuthIdentity{
		Provider: provider,
		Subject:  claims.Subject,
		Email:    strings.ToLower(claims.Email),
		Name:     claims.Name,
	}, nil
}

func (v *OAuthVerifier) keyfuncFor(ctx context.Context, provider, url string) (keyfunc.Keyfunc, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if kf, ok := v.jwks[provider]; ok {
		return kf, nil
	}
	// keyfunc refreshes the JWKS in the background for the process lifetime.
	kf, err := keyfunc.NewDefaultCtx(context.WithoutCancel(ctx), []string{url})
	if err != nil {
		return nil, errors.Join(fmt.Errorf("fetch %s jwks", provider), err)
	}
	v.jwks[provider] = kf
	return kf, nil
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
