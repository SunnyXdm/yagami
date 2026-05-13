package handlers

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	gnats "github.com/nats-io/nats.go"

	natsx "yagami/api-gateway/internal/nats"
)

// Stream is the live SSE feed of NATS events (activity + downloads + heartbeats).
// Format: standard SSE with `event:` = topic, `data:` = JSON payload.
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	msgCh, subs := h.liveNATSSubscriptions()
	defer func() {
		for _, sub := range subs {
			_ = sub.Unsubscribe()
		}
	}()

	var busCh <-chan natsx.Event
	var unsub func()
	if msgCh == nil && h.Bus != nil {
		busCh, unsub = h.Bus.Subscribe()
		defer unsub()
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// initial comment to open the stream
	fmt.Fprint(w, ": ok\n\n")
	flusher.Flush()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-keepalive.C:
			fmt.Fprint(w, ": ka\n\n")
			flusher.Flush()
		case msg, ok := <-msgCh:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Subject, string(msg.Data))
			flusher.Flush()
		case ev, ok := <-busCh:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Topic, ev.JSON)
			flusher.Flush()
		}
	}
}

func (h *Handler) liveNATSSubscriptions() (chan *gnats.Msg, []*gnats.Subscription) {
	if h.NC == nil || !h.NC.IsConnected() {
		return nil, nil
	}

	ch := make(chan *gnats.Msg, 512)
	subs := make([]*gnats.Subscription, 0, 4)
	for _, subject := range []string{"youtube.>", "download.>", "system.heartbeat", "logs.>"} {
		sub, err := h.NC.ChanSubscribe(subject, ch)
		if err != nil {
			slog.Warn("sse live nats subscribe failed", "subject", subject, "error", err)
			continue
		}
		_ = sub.SetPendingLimits(2048, 16*1024*1024)
		subs = append(subs, sub)
	}

	if len(subs) == 0 {
		return nil, nil
	}
	return ch, subs
}
