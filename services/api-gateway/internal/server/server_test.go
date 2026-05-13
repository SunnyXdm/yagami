package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestStatusWriterPreservesFlusher(t *testing.T) {
	recorder := httptest.NewRecorder()
	writer := &statusWriter{ResponseWriter: recorder}

	flusher, ok := any(writer).(http.Flusher)
	if !ok {
		t.Fatalf("statusWriter must expose http.Flusher for SSE handlers")
	}

	flusher.Flush()
	if writer.status != http.StatusOK {
		t.Fatalf("status after flush = %d, want %d", writer.status, http.StatusOK)
	}
	if !recorder.Flushed {
		t.Fatalf("underlying response recorder was not flushed")
	}
}
