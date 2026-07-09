package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	Port            string
	DatabaseURL     string
	JWTSecret       []byte
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	// CORSOrigins is a comma-separated allowlist; "*" (default) allows all,
	// which is acceptable because auth is Bearer-token, not cookie, based.
	CORSOrigins []string
	// AutoSeed enables the background OSM importer that populates courts for
	// map regions the first time anyone views them.
	AutoSeed         bool
	OverpassEndpoint string
	// Enrich enables the background worker that fills missing addresses
	// (Nominatim) and finds openly-licensed photos (Wikimedia Commons) the
	// first time a court's detail page is viewed.
	Enrich bool
	// OAuth audiences; empty disables the provider. GoogleClientIDs is a
	// comma-separated list of OAuth client IDs (web + iOS + Android);
	// AppleAudiences is normally the iOS bundle id.
	GoogleClientIDs string
	AppleAudiences  string
	// SentryDSN enables server-side crash/error reporting when set.
	SentryDSN string
}

func Load() (*Config, error) {
	c := &Config{
		Port:             getenv("PORT", "8080"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		JWTSecret:        []byte(getenv("JWT_SECRET", "")),
		AccessTokenTTL:   15 * time.Minute,
		RefreshTokenTTL:  30 * 24 * time.Hour,
		CORSOrigins:      strings.Split(getenv("CORS_ORIGINS", "*"), ","),
		AutoSeed:         getenv("AUTO_SEED", "true") != "false",
		OverpassEndpoint: getenv("OVERPASS_ENDPOINT", ""),
		Enrich:           getenv("ENRICH", "true") != "false",
		GoogleClientIDs:  getenv("GOOGLE_CLIENT_IDS", ""),
		AppleAudiences:   getenv("APPLE_AUDIENCES", ""),
		SentryDSN:        os.Getenv("SENTRY_DSN"),
	}
	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if len(c.JWTSecret) == 0 {
		if os.Getenv("APP_ENV") == "production" {
			return nil, fmt.Errorf("JWT_SECRET is required in production")
		}
		c.JWTSecret = []byte("dev-only-insecure-secret")
	}
	return c, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
