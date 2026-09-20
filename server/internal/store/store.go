// Package store owns database access: the pgx pool, goose migrations,
// and the sqlc-generated query layer in gen/.
package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
	"github.com/davisbrown/pull-up/server/migrations"
)

type Store struct {
	Pool    *pgxpool.Pool
	Queries *gen.Queries
}

// Neon scales a compute endpoint to zero after five minutes without activity,
// and an open pooled connection keeps it awake. pgx defaults hold an idle
// connection for thirty minutes, six times that threshold, so a single request
// used to pin the database awake long after it was answered. Releasing
// connections inside the threshold lets the endpoint suspend between bursts;
// reconnecting costs a wake on the next request, which is the right trade for
// a low-traffic app. Lifetime is trimmed for the same reason.
const (
	maxConnIdleTime = time.Minute
	maxConnLifetime = 30 * time.Minute
)

func New(ctx context.Context, databaseURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConnIdleTime = maxConnIdleTime
	cfg.MaxConnLifetime = maxConnLifetime
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{Pool: pool, Queries: gen.New(pool)}, nil
}

func (s *Store) Close() { s.Pool.Close() }

// Migrate runs all pending goose migrations.
func (s *Store) Migrate(ctx context.Context) error {
	db := stdlib.OpenDBFromPool(s.Pool)
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpContext(ctx, db, ".")
}
