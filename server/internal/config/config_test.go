package config

import (
	"strings"
	"testing"
)

func TestLoadRequiresDistinctStrongSecretsOutsideTests(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("UPLOAD_SIGNING_SECRET", "")
	t.Setenv("INTERNAL_TASK_SECRET", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("missing JWT_SECRET error = %v", err)
	}
	jwtSecret := strings.Repeat("j", 32)
	uploadSecret := strings.Repeat("u", 32)
	t.Setenv("JWT_SECRET", jwtSecret)
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "UPLOAD_SIGNING_SECRET") {
		t.Fatalf("missing upload secret error = %v", err)
	}
	t.Setenv("UPLOAD_SIGNING_SECRET", jwtSecret)
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "must differ") {
		t.Fatalf("shared signing secret error = %v", err)
	}
	t.Setenv("UPLOAD_SIGNING_SECRET", uploadSecret)
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "INTERNAL_TASK_SECRET") {
		t.Fatalf("missing internal secret error = %v", err)
	}
	t.Setenv("INTERNAL_TASK_SECRET", "short")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "INTERNAL_TASK_SECRET") {
		t.Fatalf("weak internal secret error = %v", err)
	}
	t.Setenv("INTERNAL_TASK_SECRET", strings.Repeat("i", 32))
	if _, err := Load(); err != nil {
		t.Fatalf("strong distinct secrets rejected: %v", err)
	}
	t.Setenv("CORS_ORIGINS", "*")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "CORS_ORIGINS") {
		t.Fatalf("wildcard CORS error = %v", err)
	}
}

func TestLoadAllowsDefaultsOnlyInExplicitTestEnvironment(t *testing.T) {
	t.Setenv("APP_ENV", "test")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("UPLOAD_SIGNING_SECRET", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("test config: %v", err)
	}
	if len(cfg.JWTSecret) == 0 || len(cfg.UploadSigningSecret) == 0 {
		t.Fatal("test defaults were not populated")
	}
}
