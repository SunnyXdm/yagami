package nats

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"yagami/api-gateway/internal/store"
)

// RunLogSink consumes the LOGS stream and batches inserts into Postgres.
func RunLogSink(ctx context.Context, js jetstream.JetStream, st *store.Store) {
	cons, err := js.CreateOrUpdateConsumer(ctx, "LOGS", jetstream.ConsumerConfig{
		Durable:       "api-gateway-logs",
		AckPolicy:     jetstream.AckExplicitPolicy,
		FilterSubject: "logs.>",
		MaxAckPending: 1024,
	})
	if err != nil {
		slog.Error("logs consumer create failed", "error", err)
		return
	}

	batch := make([]store.LogEntry, 0, 100)
	ackBatch := make([]jetstream.Msg, 0, 100)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := st.InsertLogsBatch(ctx, batch); err != nil {
			slog.Error("logs batch insert failed", "error", err, "n", len(batch))
		}
		for _, m := range ackBatch {
			_ = m.Ack()
		}
		batch = batch[:0]
		ackBatch = ackBatch[:0]
	}

	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()

	cc, err := cons.Consume(func(msg jetstream.Msg) {
		var e store.LogEntry
		if err := json.Unmarshal(msg.Data(), &e); err != nil {
			slog.Warn("bad log message", "error", err)
			_ = msg.Ack()
			return
		}
		batch = append(batch, e)
		ackBatch = append(ackBatch, msg)
		if len(batch) >= 100 {
			flush()
		}
	})
	if err != nil {
		slog.Error("logs consume failed", "error", err)
		return
	}
	defer cc.Stop()

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case <-tick.C:
			flush()
		}
	}
}
