package config

import (
	"fmt"
	"os"
	"time"
)

type Config struct {
	Port            string
	DatabaseURL     string
	JWTSecret       []byte
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
}

func Load() (*Config, error) {
	c := &Config{
		Port:            getenv("PORT", "8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		JWTSecret:       []byte(getenv("JWT_SECRET", "")),
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 30 * 24 * time.Hour,
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
