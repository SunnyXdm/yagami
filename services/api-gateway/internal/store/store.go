// Package store wraps PostgreSQL access.
//
// LEARNING (Go):
//   - pgxpool.Pool manages a connection pool — you never open/close
//     individual connections; the pool handles it automatically.
//   - Scan(&var) reads a column value into a Go variable, similar
//     to how row.Scan works in database/sql.
//   - context.Context flows through every function — it carries
//     deadlines, cancellation signals, and request-scoped values.
//     Every DB call takes a ctx so it can be cancelled if the
//     HTTP request is aborted.
package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Store holds the connection pool and provides query methods.
type Store struct {
	pool *pgxpool.Pool
}

// Event represents a row in the events table.
type Event struct {
	ID           int64     `json:"id"`
	EventType    string    `json:"event_type"`
	VideoID      *string   `json:"video_id,omitempty"`
	ChannelID    *string   `json:"channel_id,omitempty"`
	Title        *string   `json:"title,omitempty"`
	ChannelTitle *string   `json:"channel_title,omitempty"`
	DurationSecs *int      `json:"duration_seconds,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// Stats holds aggregate counts.
type Stats struct {
	TotalWatched    int `json:"total_watched"`
	TotalLiked      int `json:"total_liked"`
	TotalSubscribed int `json:"total_subscribed"`
	TotalDownloaded int `json:"total_downloaded"`
	WatchedToday    int `json:"watched_today"`
	LikedToday      int `json:"liked_today"`
}

// New creates a Store with a connection pool.
// LEARNING: In Go, constructors are just regular functions named New*().
// There are no special constructor keywords.
func New(ctx context.Context, dbURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

// Close releases all connections.
func (s *Store) Close() { s.pool.Close() }

// Ping checks database connectivity.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// ListEvents returns recent events, optionally filtered by type.
func (s *Store) ListEvents(ctx context.Context, eventType string, limit int) ([]Event, error) {
	// LEARNING: Go doesn't have a query builder in the stdlib.
	// We build SQL by hand — straightforward for simple queries.
	query := `SELECT id, event_type, video_id, channel_id, title, channel_title, duration_seconds, created_at
	           FROM events`
	args := []any{}
	argN := 1

	if eventType != "" {
		query += " WHERE event_type = $1"
		args = append(args, eventType)
		argN++
	}
	query += " ORDER BY created_at DESC"

	if limit > 0 {
		query += " LIMIT $" + itoa(argN)
		args = append(args, limit)
	}

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.EventType, &e.VideoID, &e.ChannelID,
			&e.Title, &e.ChannelTitle, &e.DurationSecs, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// GetStats returns aggregate counts for the dashboard.
func (s *Store) GetStats(ctx context.Context) (*Stats, error) {
	st := &Stats{}
	// LEARNING: Each QueryRow().Scan() is a separate DB round-trip.
	// For a high-traffic app you'd combine these into one query.
	// For our single-user app this is perfectly fine.
	s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM events WHERE event_type='watch'").Scan(&st.TotalWatched)
	s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM events WHERE event_type='like'").Scan(&st.TotalLiked)
	s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM events WHERE event_type='subscribe'").Scan(&st.TotalSubscribed)
	s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM downloads WHERE status='completed'").Scan(&st.TotalDownloaded)
	s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM events WHERE event_type='watch' AND created_at >= CURRENT_DATE").Scan(&st.WatchedToday)
	s.pool.QueryRow(ctx, "SELECT COUNT(*) FROM events WHERE event_type='like' AND created_at >= CURRENT_DATE").Scan(&st.LikedToday)
	return st, nil
}

// itoa converts int to string without importing strconv for one use.
func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return itoa(n/10) + string(rune('0'+n%10))
}
