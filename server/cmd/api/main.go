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

	"github.com/davisbrown/pull-up/server/internal/api"
	"github.com/davisbrown/pull-up/server/internal/config"
	"github.com/davisbrown/pull-up/server/internal/enrich"
	"github.com/davisbrown/pull-up/server/internal/seeder"
	"github.com/davisbrown/pull-up/server/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config", "err", err)
		os.Exit(1)
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
		en = enrich.New(st.Queries, log)
		go en.Run(ctx)
		log.Info("court enrichment enabled")
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           api.NewServer(cfg, st, log, sd, en).Routes(),
		ReadHeaderTimeout: 5 * time.Second,
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
