package store

import "testing"

func TestHydrateEventThumbnailBackfillsFromVideoID(t *testing.T) {
	videoID := "abc123xyz"
	event := Event{VideoID: &videoID}

	hydrateEventThumbnail(&event)

	if event.ThumbnailURL == nil {
		t.Fatal("expected thumbnail URL to be derived")
	}

	if got, want := *event.ThumbnailURL, "https://i.ytimg.com/vi/abc123xyz/hqdefault.jpg"; got != want {
		t.Fatalf("hydrateEventThumbnail() = %q, want %q", got, want)
	}
}

func TestHydrateEventThumbnailKeepsStoredThumbnail(t *testing.T) {
	videoID := "abc123xyz"
	existingThumbnail := "https://img.example/custom.jpg"
	event := Event{VideoID: &videoID, ThumbnailURL: &existingThumbnail}

	hydrateEventThumbnail(&event)

	if got, want := *event.ThumbnailURL, existingThumbnail; got != want {
		t.Fatalf("hydrateEventThumbnail() overwrote thumbnail with %q, want %q", got, want)
	}
}