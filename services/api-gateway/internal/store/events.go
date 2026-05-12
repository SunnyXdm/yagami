package store

import (
	"context"
	"time"
)

type Event struct {
	ID           int64     `json:"id"`
	EventType    string    `json:"event_type"`
	VideoID      *string   `json:"video_id,omitempty"`
	ChannelID    *string   `json:"channel_id,omitempty"`
	Title        *string   `json:"title,omitempty"`
	ChannelTitle *string   `json:"channel_title,omitempty"`
	ThumbnailURL *string   `json:"thumbnail_url,omitempty"`
	DurationSecs *int      `json:"duration_seconds,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

type EventQuery struct {
	Type      string
	ChannelID string
	Search    string
	Since     *time.Time
	Until     *time.Time
	AfterID   int64
	Limit     int
}

func (s *Store) ListEvents(ctx context.Context, q EventQuery) ([]Event, error) {
	if q.Limit <= 0 || q.Limit > 500 {
		q.Limit = 50
	}
	sql := `SELECT id, event_type, video_id, channel_id, title, channel_title, thumbnail_url, duration_seconds, created_at
	          FROM events WHERE 1=1`
	args := []any{}
	idx := 1
	add := func(cond string, val any) {
		sql += " AND " + cond
		args = append(args, val)
		idx++
	}
	if q.Type != "" {
		add("event_type = $"+itoa(idx), q.Type)
	}
	if q.ChannelID != "" {
		add("channel_id = $"+itoa(idx), q.ChannelID)
	}
	if q.Search != "" {
		add("(title ILIKE $"+itoa(idx)+" OR channel_title ILIKE $"+itoa(idx)+")", "%"+q.Search+"%")
	}
	if q.Since != nil {
		add("created_at >= $"+itoa(idx), *q.Since)
	}
	if q.Until != nil {
		add("created_at <= $"+itoa(idx), *q.Until)
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

	var out []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.EventType, &e.VideoID, &e.ChannelID, &e.Title, &e.ChannelTitle, &e.ThumbnailURL, &e.DurationSecs, &e.CreatedAt); err != nil {
			return nil, err
		}
		hydrateEventThumbnail(&e)
		out = append(out, e)
	}
	return out, rows.Err()
}

func hydrateEventThumbnail(e *Event) {
	if e == nil || e.ThumbnailURL != nil || e.VideoID == nil || *e.VideoID == "" {
		return
	}

	thumbnailURL := youtubeVideoThumbnailURL(*e.VideoID)
	e.ThumbnailURL = &thumbnailURL
}

func youtubeVideoThumbnailURL(videoID string) string {
	return "https://i.ytimg.com/vi/" + videoID + "/hqdefault.jpg"
}

type Stats struct {
	TotalWatched    int            `json:"total_watched"`
	TotalLiked      int            `json:"total_liked"`
	TotalSubscribed int            `json:"total_subscribed"`
	TotalDownloaded int            `json:"total_downloaded"`
	WatchedToday    int            `json:"watched_today"`
	LikedToday      int            `json:"liked_today"`
	WatchedLast7d   int            `json:"watched_last_7d"`
	LikedLast7d     int            `json:"liked_last_7d"`
	DownloadsActive int            `json:"downloads_active"`
	DownloadsFailed int            `json:"downloads_failed"`
	BytesDownloaded int64          `json:"bytes_downloaded"`
	TopChannels     []ChannelCount `json:"top_channels"`
}

type ChannelCount struct {
	ChannelID    string `json:"channel_id"`
	ChannelTitle string `json:"channel_title"`
	Count        int    `json:"count"`
}

func (s *Store) GetStats(ctx context.Context) (*Stats, error) {
	st := &Stats{}
	scalar := func(dest any, q string) error { return s.pool.QueryRow(ctx, q).Scan(dest) }
	if err := scalar(&st.TotalWatched, `SELECT COUNT(*) FROM events WHERE event_type='watch'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.TotalLiked, `SELECT COUNT(*) FROM events WHERE event_type='like'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.TotalSubscribed, `SELECT COUNT(*) FROM events WHERE event_type='subscribe'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.TotalDownloaded, `SELECT COUNT(*) FROM downloads WHERE status='completed'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.WatchedToday, `SELECT COUNT(*) FROM events WHERE event_type='watch' AND created_at >= CURRENT_DATE`); err != nil {
		return nil, err
	}
	if err := scalar(&st.LikedToday, `SELECT COUNT(*) FROM events WHERE event_type='like' AND created_at >= CURRENT_DATE`); err != nil {
		return nil, err
	}
	if err := scalar(&st.WatchedLast7d, `SELECT COUNT(*) FROM events WHERE event_type='watch' AND created_at >= NOW() - INTERVAL '7 days'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.LikedLast7d, `SELECT COUNT(*) FROM events WHERE event_type='like' AND created_at >= NOW() - INTERVAL '7 days'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.DownloadsActive, `SELECT COUNT(*) FROM downloads WHERE status IN ('queued','downloading','uploading')`); err != nil {
		return nil, err
	}
	if err := scalar(&st.DownloadsFailed, `SELECT COUNT(*) FROM downloads WHERE status='failed'`); err != nil {
		return nil, err
	}
	if err := scalar(&st.BytesDownloaded, `SELECT COALESCE(SUM(file_size),0) FROM downloads WHERE status='completed'`); err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
	    SELECT channel_id, COALESCE(MAX(channel_title), ''), COUNT(*) c
	      FROM events
	     WHERE channel_id IS NOT NULL
	  GROUP BY channel_id
	  ORDER BY c DESC LIMIT 10`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c ChannelCount
		if err := rows.Scan(&c.ChannelID, &c.ChannelTitle, &c.Count); err != nil {
			return nil, err
		}
		st.TopChannels = append(st.TopChannels, c)
	}
	return st, nil
}

type TimeseriesPoint struct {
	Bucket time.Time `json:"bucket"`
	Count  int       `json:"count"`
}

func (s *Store) Timeseries(ctx context.Context, eventType string, days int) ([]TimeseriesPoint, error) {
	if days <= 0 || days > 365 {
		days = 30
	}
	rows, err := s.pool.Query(ctx, `
	    SELECT date_trunc('day', created_at) AS bucket, COUNT(*)
	      FROM events
	     WHERE event_type = $1 AND created_at >= NOW() - ($2 || ' days')::interval
	  GROUP BY bucket
	  ORDER BY bucket`, eventType, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TimeseriesPoint
	for rows.Next() {
		var p TimeseriesPoint
		if err := rows.Scan(&p.Bucket, &p.Count); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
