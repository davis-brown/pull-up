// Package store owns database access: the pgx pool, goose migrations,
// and the sqlc-generated query layer in gen/.
package store

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/davisbrown/pull-up/server/migrations"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

type Store struct {
	Pool    *pgxpool.Pool
	Queries *gen.Queries
}

func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
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
