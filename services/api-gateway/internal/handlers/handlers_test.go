// Package handlers — tests for HTTP handlers.
//
// LEARNING (Go testing):
//   - Go has built-in testing: files named *_test.go, functions named Test*.
//   - httptest.NewRecorder() captures HTTP responses without starting a real server.
//   - httptest.NewRequest() creates fake HTTP requests.
//   - We use a mock Store (implements the same interface) to test handlers
//     without needing a real database.
package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"yagami/api-gateway/internal/store"
)

// ── Mock Store ──────────────────────────────────────────────

// mockStore implements the same methods as store.Store so we can
// test handlers without a real database connection.
type mockStore struct {
	events   []store.Event
	stats    *store.Stats
	pingErr  error
	queryErr error
}

func (m *mockStore) Ping(ctx context.Context) error {
	return m.pingErr
}

func (m *mockStore) ListEvents(ctx context.Context, eventType string, limit int) ([]store.Event, error) {
	if m.queryErr != nil {
		return nil, m.queryErr
	}

	// Simulate filtering
	if eventType == "" {
		if limit > 0 && limit < len(m.events) {
			return m.events[:limit], nil
		}
		return m.events, nil
	}

	var filtered []store.Event
	for _, e := range m.events {
		if e.EventType == eventType {
			filtered = append(filtered, e)
		}
	}
	if limit > 0 && limit < len(filtered) {
		return filtered[:limit], nil
	}
	return filtered, nil
}

func (m *mockStore) GetStats(ctx context.Context) (*store.Stats, error) {
	if m.queryErr != nil {
		return nil, m.queryErr
	}
	return m.stats, nil
}

func (m *mockStore) Close() {}

// newTestHandler creates a Handler with a mock store for testing.
func newTestHandler(ms *mockStore) *Handler {
	return &Handler{store: ms}
}

// ── Health Tests ────────────────────────────────────────────

func TestHealth_OK(t *testing.T) {
	h := newTestHandler(&mockStore{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/health", nil)

	h.Health(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["status"] != "healthy" {
		t.Errorf("status = %q, want %q", body["status"], "healthy")
	}
}

func TestHealth_Unhealthy(t *testing.T) {
	h := newTestHandler(&mockStore{pingErr: context.DeadlineExceeded})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/health", nil)

	h.Health(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}

	var body map[string]string
	json.NewDecoder(rec.Body).Decode(&body)
	if body["status"] != "unhealthy" {
		t.Errorf("status = %q, want %q", body["status"], "unhealthy")
	}
}

// ── ListEvents Tests ────────────────────────────────────────

func TestListEvents_ReturnsAll(t *testing.T) {
	title := "Test Video"
	ms := &mockStore{
		events: []store.Event{
			{ID: 1, EventType: "watch", Title: &title, CreatedAt: time.Now()},
			{ID: 2, EventType: "like", Title: &title, CreatedAt: time.Now()},
		},
	}
	h := newTestHandler(ms)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/events", nil)

	h.ListEvents(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var events []store.Event
	json.NewDecoder(rec.Body).Decode(&events)
	if len(events) != 2 {
		t.Errorf("got %d events, want 2", len(events))
	}
}

func TestListEvents_FilterByType(t *testing.T) {
	title := "Liked"
	ms := &mockStore{
		events: []store.Event{
			{ID: 1, EventType: "watch", CreatedAt: time.Now()},
			{ID: 2, EventType: "like", Title: &title, CreatedAt: time.Now()},
			{ID: 3, EventType: "like", Title: &title, CreatedAt: time.Now()},
		},
	}
	h := newTestHandler(ms)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/events?type=like", nil)

	h.ListEvents(rec, req)

	var events []store.Event
	json.NewDecoder(rec.Body).Decode(&events)
	if len(events) != 2 {
		t.Errorf("got %d events, want 2 likes", len(events))
	}
}

func TestListEvents_WithLimit(t *testing.T) {
	ms := &mockStore{
		events: []store.Event{
			{ID: 1, EventType: "watch", CreatedAt: time.Now()},
			{ID: 2, EventType: "watch", CreatedAt: time.Now()},
			{ID: 3, EventType: "watch", CreatedAt: time.Now()},
		},
	}
	h := newTestHandler(ms)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/events?limit=2", nil)

	h.ListEvents(rec, req)

	var events []store.Event
	json.NewDecoder(rec.Body).Decode(&events)
	if len(events) != 2 {
		t.Errorf("got %d events, want 2 (limited)", len(events))
	}
}

func TestListEvents_EmptyReturnsArray(t *testing.T) {
	h := newTestHandler(&mockStore{events: nil})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/events", nil)

	h.ListEvents(rec, req)

	// Must return [] not null
	body := rec.Body.String()
	if body == "null\n" || body == "null" {
		t.Error("got null, want empty JSON array []")
	}
}

func TestListEvents_InvalidLimit(t *testing.T) {
	ms := &mockStore{
		events: []store.Event{
			{ID: 1, EventType: "watch", CreatedAt: time.Now()},
		},
	}
	h := newTestHandler(ms)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/events?limit=abc", nil)

	h.ListEvents(rec, req)

	// Should fallback to default limit, not error
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}

// ── Stats Tests ─────────────────────────────────────────────

func TestStats_OK(t *testing.T) {
	ms := &mockStore{
		stats: &store.Stats{
			TotalWatched:    100,
			TotalLiked:      50,
			TotalSubscribed: 20,
			TotalDownloaded: 10,
			WatchedToday:    5,
			LikedToday:      2,
		},
	}
	h := newTestHandler(ms)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/stats", nil)

	h.Stats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var stats store.Stats
	json.NewDecoder(rec.Body).Decode(&stats)
	if stats.TotalWatched != 100 {
		t.Errorf("TotalWatched = %d, want 100", stats.TotalWatched)
	}
	if stats.LikedToday != 2 {
		t.Errorf("LikedToday = %d, want 2", stats.LikedToday)
	}
}

func TestStats_DBError(t *testing.T) {
	ms := &mockStore{queryErr: context.DeadlineExceeded}
	h := newTestHandler(ms)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/stats", nil)

	h.Stats(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

// ── JSON Response Tests ────────────────────────────────────

func TestWriteJSON_ContentType(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, map[string]string{"hello": "world"})

	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}
}

func TestWriteJSON_StatusCode(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusCreated, "ok")

	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusCreated)
	}
}
