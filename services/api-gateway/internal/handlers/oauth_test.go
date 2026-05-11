package handlers

import "testing"

func TestGoogleRedirectURLIsFixedLocalhostCallback(t *testing.T) {
	const want = "http://localhost:8787/api/oauth/google/callback"
	if googleRedirectURL != want {
		t.Fatalf("googleRedirectURL = %q, want %q", googleRedirectURL, want)
	}
}