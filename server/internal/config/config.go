package config

import (
	"bytes"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/davisbrown/pull-up/server/internal/auth"
)

type Config struct {
	Port                 string
	DatabaseURL          string
	JWTSecret            []byte
	UploadSigningSecret  []byte
	AccessTokenTTL       time.Duration
	RefreshTokenTTL      time.Duration
	EmailVerificationTTL time.Duration
	// CORSOrigins is a comma-separated allowlist. Web authentication uses a
	// credentialed HttpOnly cookie, so wildcard origins are never appropriate.
	CORSOrigins []string
	// AutoSeed enables the background OSM importer that populates courts for
	// map regions the first time anyone views them.
	AutoSeed         bool
	OverpassEndpoint string
	// Enrich enables the background worker that fills missing addresses and
	// finds openly-licensed photos on first view of a court's detail page.
	Enrich bool
	// OAuth audiences; empty disables the provider. GoogleClientIDs is a
	// comma-separated list of OAuth client IDs (web + iOS + Android);
	// AppleAudiences is normally the iOS bundle id.
	GoogleClientIDs         string
	AppleAudiences          string
	AppleClientID           string
	AppleTeamID             string
	AppleKeyID              string
	ApplePrivateKey         string // Sign in with Apple .p8 contents (PEM)
	AppleTokenEncryptionKey string
	// AppleKeysURL overrides Apple's JWKS endpoint; tests only.
	AppleKeysURL string
	// SentryDSN enables server-side crash/error reporting when set.
	SentryDSN string
	// Workers AI credentials for text moderation. Both must be set; with
	// either empty, user text is accepted unscreened (local dev and CI).
	CloudflareAccountID string
	CloudflareAIToken   string
	ModerationRequired  bool
	// MapillaryToken enables the enricher's Mapillary photo source. Optional;
	// empty leaves it off and Commons still runs.
	MapillaryToken string
	// Per-IP rate limits (requests/minute). 0 disables the limiter.
	RateLimitAuthPerMin      int
	RateLimitWritePerMin     int
	RateLimitDiscoveryPerMin int
	// TrustCloudflareHeaders permits CF-Connecting-IP/X-Forwarded-For to affect
	// client identity. Enable only when the origin accepts traffic from a
	// trusted Cloudflare proxy path.
	TrustCloudflareHeaders bool
	// InternalTaskSecret guards scheduler, email-delivery, and media Worker
	// integration requests.
	InternalTaskSecret string
	// Version and Commit identify the running container image, exposed on
	// /internal/version so deploys can confirm rollout.
	Version string
	Commit  string
}

func Load() (*Config, error) {
	c := &Config{
		Port:                     getenv("PORT", "8080"),
		DatabaseURL:              os.Getenv("DATABASE_URL"),
		JWTSecret:                []byte(getenv("JWT_SECRET", "")),
		UploadSigningSecret:      []byte(getenv("UPLOAD_SIGNING_SECRET", "")),
		AccessTokenTTL:           15 * time.Minute,
		RefreshTokenTTL:          30 * 24 * time.Hour,
		EmailVerificationTTL:     24 * time.Hour,
		CORSOrigins:              strings.Split(getenv("CORS_ORIGINS", "http://localhost:8081"), ","),
		AutoSeed:                 getenv("AUTO_SEED", "true") != "false",
		OverpassEndpoint:         getenv("OVERPASS_ENDPOINT", ""),
		Enrich:                   getenv("ENRICH", "true") != "false",
		GoogleClientIDs:          getenv("GOOGLE_CLIENT_IDS", ""),
		AppleAudiences:           getenv("APPLE_AUDIENCES", ""),
		AppleClientID:            os.Getenv("APPLE_CLIENT_ID"),
		AppleTeamID:              os.Getenv("APPLE_TEAM_ID"),
		AppleKeyID:               os.Getenv("APPLE_KEY_ID"),
		ApplePrivateKey:          os.Getenv("APPLE_PRIVATE_KEY"),
		AppleTokenEncryptionKey:  os.Getenv("APPLE_TOKEN_ENCRYPTION_KEY"),
		SentryDSN:                os.Getenv("SENTRY_DSN"),
		CloudflareAccountID:      os.Getenv("CLOUDFLARE_ACCOUNT_ID"),
		CloudflareAIToken:        os.Getenv("CLOUDFLARE_AI_TOKEN"),
		ModerationRequired:       os.Getenv("APP_ENV") == "production",
		MapillaryToken:           os.Getenv("MAPILLARY_TOKEN"),
		RateLimitAuthPerMin:      getenvInt("RATE_LIMIT_AUTH_PER_MIN", 10),
		RateLimitWritePerMin:     getenvInt("RATE_LIMIT_WRITE_PER_MIN", 60),
		RateLimitDiscoveryPerMin: getenvInt("RATE_LIMIT_DISCOVERY_PER_MIN", 120),
		TrustCloudflareHeaders:   getenv("TRUST_CF_CONNECTING_IP", "false") == "true",
		InternalTaskSecret:       getenv("INTERNAL_TASK_SECRET", ""),
		Version:                  getenv("VERSION", "dev"),
		Commit:                   getenv("COMMIT", "unknown"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if os.Getenv("APP_ENV") == "test" {
		if len(c.JWTSecret) == 0 {
			c.JWTSecret = []byte("test-only-jwt-secret")
		}
		if len(c.UploadSigningSecret) == 0 {
			c.UploadSigningSecret = []byte("test-only-upload-secret")
		}
		return c, nil
	}
	if len(c.JWTSecret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 bytes")
	}
	if len(c.UploadSigningSecret) < 32 {
		return nil, fmt.Errorf("UPLOAD_SIGNING_SECRET must be at least 32 bytes")
	}
	if bytes.Equal(c.JWTSecret, c.UploadSigningSecret) {
		return nil, fmt.Errorf("UPLOAD_SIGNING_SECRET must differ from JWT_SECRET")
	}
	if len(c.InternalTaskSecret) < 32 {
		return nil, fmt.Errorf("INTERNAL_TASK_SECRET must be at least 32 bytes")
	}
	// Apple sign-in requires token management, so refuse to boot a production
	// API that would answer every Apple sign-in with 503.
	if os.Getenv("APP_ENV") == "production" && strings.TrimSpace(c.AppleAudiences) != "" {
		if c.AppleClientID == "" || c.AppleTeamID == "" || c.AppleKeyID == "" {
			return nil, fmt.Errorf("APPLE_CLIENT_ID, APPLE_TEAM_ID and APPLE_KEY_ID are required when APPLE_AUDIENCES is set")
		}
		if _, err := auth.ParseApplePrivateKey(c.ApplePrivateKey); err != nil {
			return nil, fmt.Errorf("APPLE_PRIVATE_KEY: %w", err)
		}
		if len(c.AppleTokenEncryptionKey) != 32 {
			return nil, fmt.Errorf("APPLE_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes")
		}
	}
	for _, origin := range c.CORSOrigins {
		if strings.TrimSpace(origin) == "*" {
			return nil, fmt.Errorf("CORS_ORIGINS must not contain *")
		}
	}
	return c, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
