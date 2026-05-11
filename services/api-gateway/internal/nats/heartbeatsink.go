package nats

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/nats-io/nats.go/jetstream"

	"yagami/api-gateway/internal/store"
)

// RunHeartbeatSink consumes system.heartbeat and upserts service_heartbeats.
func RunHeartbeatSink(ctx context.Context, js jetstream.JetStream, st *store.Store) {
	cons, err := js.CreateOrUpdateConsumer(ctx, "SYSTEM", jetstream.ConsumerConfig{
		Durable:       "api-gateway-hb",
		AckPolicy:     jetstream.AckExplicitPolicy,
		FilterSubject: "system.heartbeat",
		MaxAckPending: 256,
	})
	if err != nil {
		slog.Error("heartbeat consumer failed", "error", err)
		return
	}
	cc, err := cons.Consume(func(msg jetstream.Msg) {
		var h store.Heartbeat
		if err := json.Unmarshal(msg.Data(), &h); err != nil {
			slog.Warn("bad heartbeat", "error", err)
			_ = msg.Ack()
			return
		}
		if h.Service == "" {
			_ = msg.Ack()
			return
		}
		if err := st.UpsertHeartbeat(ctx, h); err != nil {
			slog.Error("heartbeat upsert", "error", err, "service", h.Service)
			_ = msg.Nak()
			return
		}
		_ = msg.Ack()
	})
	if err != nil {
		slog.Error("heartbeat consume failed", "error", err)
		return
	}
	defer cc.Stop()
	<-ctx.Done()
}
