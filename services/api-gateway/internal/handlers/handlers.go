// Package handlers contains HTTP request handlers.
//
// LEARNING (Go):
//   - Handlers are just functions with signature (http.ResponseWriter, *http.Request).
//   - We group them on a struct (Handler) that holds shared dependencies (the store).
//     This is Go's version of dependency injection — no framework needed.
//   - json.NewEncoder(w).Encode(v) streams JSON directly to the response writer.
//   - strconv.Atoi converts string → int (Atoi = "ASCII to integer").
package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"yagami/api-gateway/internal/store"
)

// Handler holds shared dependencies for all HTTP handlers.
type Handler struct {
	store *store.Store
}

// New creates a Handler. In Go, this is the conventional "constructor".
func New(s *store.Store) *Handler {
	return &Handler{store: s}
}

// Health checks if the database is reachable.
// GET /health → {"status": "healthy"} or {"status": "unhealthy"}
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	if err := h.store.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"status": "unhealthy",
			"error":  err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
}

// ListEvents returns recent events from the database.
// GET /api/events?type=watch&limit=20
func (h *Handler) ListEvents(w http.ResponseWriter, r *http.Request) {
	// LEARNING: r.URL.Query().Get("key") reads a query-string parameter.
	// It returns "" if the parameter is absent (no error, no nil).
	eventType := r.URL.Query().Get("type")

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = v
		}
	}

	events, err := h.store.ListEvents(r.Context(), eventType, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// LEARNING: In Go, a nil slice marshals to JSON null, not [].
	// We convert to an empty slice to always return a JSON array.
	if events == nil {
		events = []store.Event{}
	}
	writeJSON(w, http.StatusOK, events)
}

// Stats returns aggregate activity counts.
// GET /api/stats
func (h *Handler) Stats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.store.GetStats(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

// writeJSON is a small helper that sets headers and encodes the response.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
