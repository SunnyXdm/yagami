package handlers

import (
	"encoding/json"
	"testing"

	"yagami/api-gateway/internal/store"
)

func TestRetryDownloadPayloadPreservesRequesterMetadata(t *testing.T) {
	title := "Running a 35B AI Model on 6GB VRAM, FAST"
	url := "https://www.youtube.com/watch?v=8F_5pdcD3HY"
	thumbnail := "https://i.ytimg.com/vi/8F_5pdcD3HY/maxresdefault.jpg"
	channel := "Codacus"
	requesterChatID := int64(680240877)

	payload, err := retryDownloadPayload("8F_5pdcD3HY", &store.Download{
		Title:           &title,
		URL:             &url,
		ThumbnailURL:    &thumbnail,
		Channel:         &channel,
		RequesterChatID: &requesterChatID,
	})
	if err != nil {
		t.Fatalf("retryDownloadPayload returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal retry payload: %v", err)
	}

	assertJSONField(t, got, "video_id", "8F_5pdcD3HY")
	assertJSONField(t, got, "title", title)
	assertJSONField(t, got, "url", url)
	assertJSONField(t, got, "thumbnail", thumbnail)
	assertJSONField(t, got, "channel", channel)
	assertJSONField(t, got, "requester_chat_id", float64(requesterChatID))
}

func TestRetryDownloadPayloadFallsBackToVideoURL(t *testing.T) {
	payload, err := retryDownloadPayload("abc123", &store.Download{})
	if err != nil {
		t.Fatalf("retryDownloadPayload returned error: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal retry payload: %v", err)
	}

	assertJSONField(t, got, "video_id", "abc123")
	assertJSONField(t, got, "title", "abc123")
	assertJSONField(t, got, "url", "https://www.youtube.com/watch?v=abc123")
	if _, ok := got["requester_chat_id"]; ok {
		t.Fatalf("did not expect requester_chat_id in fallback payload")
	}
}

func assertJSONField(t *testing.T, got map[string]any, field string, want any) {
	t.Helper()
	if got[field] != want {
		t.Fatalf("%s = %#v, want %#v", field, got[field], want)
	}
}
