package store

import (
	"context"
	"time"
)

type Download struct {
	ID              int64      `json:"id"`
	VideoID         string     `json:"video_id"`
	Title           *string    `json:"title,omitempty"`
	URL             *string    `json:"url,omitempty"`
	Channel         *string    `json:"channel,omitempty"`
	ChannelID       *string    `json:"channel_id,omitempty"`
	Duration        *string    `json:"duration,omitempty"`
	ThumbnailURL    *string    `json:"thumbnail_url,omitempty"`
	Status          string     `json:"status"`
	FileSize        *int64     `json:"file_size,omitempty"`
	FilePath        *string    `json:"file_path,omitempty"`
	TelegramMsgID   *int64     `json:"telegram_msg_id,omitempty"`
	TelegramChatID  *int64     `json:"telegram_chat_id,omitempty"`
	ErrorMessage    *string    `json:"error,omitempty"`
	Attempts        int        `json:"attempts"`
	RequesterChatID *int64     `json:"requester_chat_id,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	StartedAt       *time.Time `json:"started_at,omitempty"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

func (s *Store) ListDownloads(ctx context.Context, status string, limit int) ([]Download, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	sql := `SELECT id, video_id, title, url, channel, channel_id, duration, thumbnail_url,
	               status, file_size, file_path,
	               telegram_msg_id, telegram_chat_id, error_message, attempts,
	               requester_chat_id, created_at, started_at, completed_at, updated_at
	          FROM downloads`
	args := []any{}
	if status != "" {
		sql += ` WHERE status=$1`
		args = append(args, status)
	}
	sql += ` ORDER BY id DESC LIMIT ` + itoa(limit)
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Download
	for rows.Next() {
		var d Download
		if err := rows.Scan(&d.ID, &d.VideoID, &d.Title, &d.URL, &d.Channel, &d.ChannelID, &d.Duration, &d.ThumbnailURL,
			&d.Status, &d.FileSize, &d.FilePath,
			&d.TelegramMsgID, &d.TelegramChatID, &d.ErrorMessage, &d.Attempts,
			&d.RequesterChatID, &d.CreatedAt, &d.StartedAt, &d.CompletedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) GetDownloadByVideoID(ctx context.Context, videoID string) (*Download, error) {
	var d Download
	err := s.pool.QueryRow(ctx, `
	    SELECT id, video_id, title, url, channel, channel_id, duration, thumbnail_url,
	           status, file_size, file_path,
	           telegram_msg_id, telegram_chat_id, error_message, attempts,
	           requester_chat_id, created_at, started_at, completed_at, updated_at
	      FROM downloads WHERE video_id=$1
	  ORDER BY id DESC LIMIT 1`, videoID).
		Scan(&d.ID, &d.VideoID, &d.Title, &d.URL, &d.Channel, &d.ChannelID, &d.Duration, &d.ThumbnailURL,
			&d.Status, &d.FileSize, &d.FilePath,
			&d.TelegramMsgID, &d.TelegramChatID, &d.ErrorMessage, &d.Attempts,
			&d.RequesterChatID, &d.CreatedAt, &d.StartedAt, &d.CompletedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &d, nil
}
