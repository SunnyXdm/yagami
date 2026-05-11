package nats

import (
	"context"
	"log/slog"

	"github.com/nats-io/nats.go/jetstream"
)

// RunEventFanout subscribes to YOUTUBE + DOWNLOADS and fans events into the
// in-process Bus so SSE clients receive them immediately.
func RunEventFanout(ctx context.Context, js jetstream.JetStream, bus *Bus) {
	for _, spec := range []struct {
		stream  string
		durable string
		subject string
	}{
		{"YOUTUBE", "api-gateway-fanout-youtube", "youtube.>"},
		{"DOWNLOADS", "api-gateway-fanout-downloads", "download.complete"},
		{"SYSTEM", "api-gateway-fanout-system", "system.heartbeat"},
		{"LOGS", "api-gateway-fanout-logs", "logs.>"},
	} {
		spec := spec
		go func() {
			// Workqueue streams (DOWNLOADS) require explicit ack and
			// must use DeliverAll; other limits-based streams accept
			// ack-none and start at "new" so we don't replay history.
			ackPolicy := jetstream.AckNonePolicy
			deliverPolicy := jetstream.DeliverNewPolicy
			if spec.stream == "DOWNLOADS" {
				ackPolicy = jetstream.AckExplicitPolicy
				deliverPolicy = jetstream.DeliverAllPolicy
			}
			cons, err := js.CreateOrUpdateConsumer(ctx, spec.stream, jetstream.ConsumerConfig{
				Durable:       spec.durable,
				AckPolicy:     ackPolicy,
				DeliverPolicy: deliverPolicy,
				FilterSubject: spec.subject,
			})
			if err != nil {
				slog.Error("fanout consumer failed", "stream", spec.stream, "error", err)
				return
			}
			cc, err := cons.Consume(func(msg jetstream.Msg) {
				bus.Publish(Event{
					Topic: msg.Subject(),
					JSON:  string(msg.Data()),
				})
				_ = msg.Ack()
			})
			if err != nil {
				slog.Error("fanout consume failed", "stream", spec.stream, "error", err)
				return
			}
			defer cc.Stop()
			<-ctx.Done()
		}()
	}
}
