package store

import (
	"context"
	"encoding/json"
	"time"
)

type Heartbeat struct {
	Service    string          `json:"service"`
	Status     string          `json:"status"`
	Version    *string         `json:"version,omitempty"`
	Details    json.RawMessage `json:"details,omitempty"`
	LastSeenAt time.Time       `json:"last_seen_at"`
	SecondsAgo int64           `json:"seconds_ago"`
}

func (s *Store) UpsertHeartbeat(ctx context.Context, h Heartbeat) error {
	var details any
	if len(h.Details) > 0 {
		details = string(h.Details)
	}
	_, err := s.pool.Exec(ctx, `
	    INSERT INTO service_heartbeats (service, status, version, details, last_seen_at)
	    VALUES ($1,$2,$3,$4::jsonb, NOW())
	    ON CONFLICT (service) DO UPDATE SET
	        status=EXCLUDED.status, version=EXCLUDED.version,
	        details=EXCLUDED.details, last_seen_at=NOW()`,
		h.Service, h.Status, h.Version, details)
	return err
}

func (s *Store) ListHeartbeats(ctx context.Context) ([]Heartbeat, error) {
	rows, err := s.pool.Query(ctx, `
	    SELECT service, status, version, details, last_seen_at,
	           EXTRACT(EPOCH FROM (NOW() - last_seen_at))::bigint
	      FROM service_heartbeats ORDER BY service`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Heartbeat
	for rows.Next() {
		var h Heartbeat
		var details []byte
		if err := rows.Scan(&h.Service, &h.Status, &h.Version, &details, &h.LastSeenAt, &h.SecondsAgo); err != nil {
			return nil, err
		}
		if len(details) > 0 {
			h.Details = details
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
