package nats

import (
	"context"
	"errors"
	"time"

	"github.com/nats-io/nats.go/jetstream"
)

// EnsureStreams creates/updates the four streams the system uses.
// Idempotent: safe to call on every startup.
func EnsureStreams(js jetstream.JetStream) error {
	specs := []jetstream.StreamConfig{
		{
			Name:        "YOUTUBE",
			Description: "YouTube activity events (likes, watches, subs)",
			Subjects:    []string{"youtube.>"},
			Retention:   jetstream.LimitsPolicy,
			MaxAge:      30 * 24 * time.Hour,
			MaxBytes:    512 * 1024 * 1024,
			Storage:     jetstream.FileStorage,
		},
		{
			Name:        "DOWNLOADS",
			Description: "Download requests and completion notices",
			Subjects:    []string{"download.>"},
			Retention:   jetstream.WorkQueuePolicy,
			MaxAge:      7 * 24 * time.Hour,
			Storage:     jetstream.FileStorage,
		},
		{
			Name:        "SYSTEM",
			Description: "Heartbeats and ad-hoc system messages",
			Subjects:    []string{"system.>"},
			Retention:   jetstream.LimitsPolicy,
			MaxAge:      24 * time.Hour,
			MaxMsgs:     10_000,
			Storage:     jetstream.FileStorage,
		},
		{
			Name:        "LOGS",
			Description: "Structured logs from every service",
			Subjects:    []string{"logs.>"},
			Retention:   jetstream.LimitsPolicy,
			MaxAge:      14 * 24 * time.Hour,
			MaxBytes:    1024 * 1024 * 1024,
			Storage:     jetstream.FileStorage,
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, spec := range specs {
		_, err := js.CreateStream(ctx, spec)
		if err == nil {
			continue
		}
		if errors.Is(err, jetstream.ErrStreamNameAlreadyInUse) {
			if _, err := js.UpdateStream(ctx, spec); err != nil {
				return err
			}
			continue
		}
		return err
	}
	return nil
}
