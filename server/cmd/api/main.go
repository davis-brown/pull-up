package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"

	"github.com/davisbrown/pull-up/server/internal/api"
	"github.com/davisbrown/pull-up/server/internal/config"
	"github.com/davisbrown/pull-up/server/internal/enrich"
	"github.com/davisbrown/pull-up/server/internal/seeder"
	"github.com/davisbrown/pull-up/server/internal/store"
)

var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	// Cloudflare Containers preserves stdout/stderr; JSON keeps request and
	// background-work fields independently queryable in Workers Logs.
	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))

	// Expose the ldflags-stamped identity to config.Load, but never clobber
	// values already provided by the environment: the container image is built
	// without build args, so the deploy pipeline injects COMMIT at runtime.
	if os.Getenv("VERSION") == "" {
		os.Setenv("VERSION", version)
	}
	if os.Getenv("COMMIT") == "" {
		os.Setenv("COMMIT", commit)
	}

	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
	}

	if cfg.SentryDSN != "" {
		if err := sentry.Init(sentry.ClientOptions{
			Dsn:         cfg.SentryDSN,
			Environment: os.Getenv("APP_ENV"),
		}); err != nil {
			log.Error("sentry init", "err", err)
		} else {
			defer sentry.Flush(2 * time.Second)
			log.Info("sentry enabled")
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("connect database", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	if err := st.Migrate(ctx); err != nil {
		log.Error("migrate", "err", err)
		os.Exit(1)
	}
	log.Info("migrations up to date")

	var sd *seeder.Seeder
	if cfg.AutoSeed {
		sd = seeder.New(st.Queries, cfg.OverpassEndpoint, log)
		go sd.Run(ctx)
		log.Info("osm auto-seeding enabled")
	}

	var en *enrich.Enricher
	if cfg.Enrich {
		en = enrich.New(st.Queries, log, cfg.MapillaryToken)
		go en.Run(ctx)
		log.Info("court enrichment enabled")
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.NewServer(cfg, st, log, sd, en).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	log.Info("api listening", "port", cfg.Port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}
