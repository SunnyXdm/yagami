package store

import (
	"context"
	"encoding/json"
	"time"
)

type LogEntry struct {
	ID      int64           `json:"id"`
	Ts      time.Time       `json:"ts"`
	Service string          `json:"service"`
	Level   string          `json:"level"`
	Message string          `json:"message"`
	Fields  json.RawMessage `json:"fields,omitempty"`
	Error   *string         `json:"error,omitempty"`
}

type LogQuery struct {
	Service string
	Level   string
	Search  string
	Since   *time.Time
	Until   *time.Time
	AfterID int64
	Limit   int
}

func (s *Store) InsertLogsBatch(ctx context.Context, entries []LogEntry) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for _, e := range entries {
		var fields any
		if len(e.Fields) > 0 {
			fields = string(e.Fields)
		}
		if _, err := tx.Exec(ctx, `
		    INSERT INTO service_logs (ts, service, level, message, fields, error)
		    VALUES (COALESCE($1, NOW()), $2, $3, $4, $5::jsonb, $6)`,
			nullTime(e.Ts), e.Service, e.Level, e.Message, fields, e.Error); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func nullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

func (s *Store) ListLogs(ctx context.Context, q LogQuery) ([]LogEntry, error) {
	if q.Limit <= 0 || q.Limit > 1000 {
		q.Limit = 100
	}
	sql := `SELECT id, ts, service, level, message, fields, error FROM service_logs WHERE 1=1`
	args := []any{}
	idx := 1
	add := func(c string, v any) {
		sql += " AND " + c
		args = append(args, v)
		idx++
	}
	if q.Service != "" {
		add("service = $"+itoa(idx), q.Service)
	}
	if q.Level != "" {
		add("level = $"+itoa(idx), q.Level)
	}
	if q.Search != "" {
		add("message ILIKE $"+itoa(idx), "%"+q.Search+"%")
	}
	if q.Since != nil {
		add("ts >= $"+itoa(idx), *q.Since)
	}
	if q.Until != nil {
		add("ts <= $"+itoa(idx), *q.Until)
	}
	if q.AfterID > 0 {
		add("id < $"+itoa(idx), q.AfterID)
	}
	sql += " ORDER BY id DESC LIMIT $" + itoa(idx)
	args = append(args, q.Limit)

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LogEntry
	for rows.Next() {
		var e LogEntry
		var fields []byte
		if err := rows.Scan(&e.ID, &e.Ts, &e.Service, &e.Level, &e.Message, &fields, &e.Error); err != nil {
			return nil, err
		}
		if len(fields) > 0 {
			e.Fields = fields
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) DistinctLogServices(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT DISTINCT service FROM service_logs ORDER BY service`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (s *Store) PruneLogs(ctx context.Context, olderThan time.Duration) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM service_logs WHERE ts < NOW() - $1::interval`,
		olderThan.String())
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
