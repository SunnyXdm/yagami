// Package store — PostgreSQL access wrapped in a small façade.
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
}

func New(ctx context.Context, dbURL string) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close()                              { s.pool.Close() }
func (s *Store) Pool() *pgxpool.Pool                 { return s.pool }
func (s *Store) Ping(ctx context.Context) error      { return s.pool.Ping(ctx) }
func IsNotFound(err error) bool                      { return errors.Is(err, pgx.ErrNoRows) }
