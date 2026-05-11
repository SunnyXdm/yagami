package handlers

import (
	"context"
	"fmt"
	"net/http"
	"time"
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

	ch, unsub := h.Bus.Subscribe()
	defer unsub()

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
		case ev, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Topic, ev.JSON)
			flusher.Flush()
		}
	}
}
