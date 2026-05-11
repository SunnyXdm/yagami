package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHasUsableYouTubeCookies(t *testing.T) {
	good := "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue"
	if !hasUsableYouTubeCookies(good) {
		t.Fatalf("expected Netscape youtube cookie export to be accepted")
	}

	bad := "sessionid=value"
	if hasUsableYouTubeCookies(bad) {
		t.Fatalf("expected malformed cookie content to be rejected")
	}
}

func TestHasUsableYouTubeCookiesFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cookies.txt")
	if err := os.WriteFile(path, []byte(".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue"), 0o600); err != nil {
		t.Fatalf("write cookie file: %v", err)
	}
	if !hasUsableYouTubeCookiesFile(path) {
		t.Fatalf("expected cookie file to be reported as ready")
	}
	if hasUsableYouTubeCookiesFile(filepath.Join(dir, "missing.txt")) {
		t.Fatalf("expected missing file to be reported as not ready")
	}
}