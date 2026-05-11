package store

import (
	"context"
	"time"
)

type Setting struct {
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Description *string   `json:"description,omitempty"`
	IsSecret    bool      `json:"is_secret"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (s *Store) ListSettings(ctx context.Context) ([]Setting, error) {
	rows, err := s.pool.Query(ctx, `SELECT key, value, description, is_secret, updated_at FROM settings ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Setting
	for rows.Next() {
		var st Setting
		if err := rows.Scan(&st.Key, &st.Value, &st.Description, &st.IsSecret, &st.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}

func (s *Store) GetSetting(ctx context.Context, key string) (string, error) {
	var v string
	err := s.pool.QueryRow(ctx, `SELECT value FROM settings WHERE key=$1`, key).Scan(&v)
	if IsNotFound(err) {
		return "", nil
	}
	return v, err
}

func (s *Store) GetSettings(ctx context.Context, keys ...string) (map[string]string, error) {
	out := make(map[string]string, len(keys))
	rows, err := s.pool.Query(ctx, `SELECT key, value FROM settings WHERE key = ANY($1)`, keys)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func (s *Store) SetSetting(ctx context.Context, key, value string) error {
	_, err := s.pool.Exec(ctx, `
	    INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
	    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, key, value)
	return err
}

func (s *Store) SetSettings(ctx context.Context, kv map[string]string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for k, v := range kv {
		if _, err := tx.Exec(ctx, `
		    INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
		    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, k, v); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
