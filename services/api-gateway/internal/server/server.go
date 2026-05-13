// Package server — HTTP routing and middleware for api-gateway.
package server

import (
	"log/slog"
	"net/http"
	"time"

	"yagami/api-gateway/internal/handlers"
)

// New returns the root HTTP handler with all routes mounted.
func New(h *handlers.Handler) http.Handler {
	mux := http.NewServeMux()

	// public
	mux.HandleFunc("GET /api/health", h.Health)
	mux.HandleFunc("GET /api/setup/status", h.Status)
	mux.HandleFunc("POST /api/setup", h.Setup)
	mux.HandleFunc("POST /api/auth/login", h.Login)
	mux.HandleFunc("POST /api/auth/logout", h.Logout)
	// OAuth callback is GET-only and doesn't require an active session
	// (Google redirects the browser back here directly).
	mux.HandleFunc("GET /api/oauth/google/callback", h.OAuthCallback)

	// authenticated
	mux.HandleFunc("GET /api/auth/me", h.Auth(h.Me))

	mux.HandleFunc("GET /api/settings", h.Auth(h.ListSettings))
	mux.HandleFunc("PUT /api/settings", h.Auth(h.UpdateSettings))
	mux.HandleFunc("GET /api/settings/status", h.Auth(h.SettingsStatus))

	mux.HandleFunc("POST /api/oauth/google/start", h.Auth(h.OAuthStart))

	mux.HandleFunc("GET /api/events", h.Auth(h.ListEvents))
	mux.HandleFunc("GET /api/stats", h.Auth(h.Stats))
	mux.HandleFunc("GET /api/stats/timeseries", h.Auth(h.Timeseries))

	mux.HandleFunc("GET /api/downloads", h.Auth(h.ListDownloads))
	mux.HandleFunc("POST /api/downloads/{videoId}/retry", h.Auth(h.RetryDownload))

	mux.HandleFunc("GET /api/logs", h.Auth(h.ListLogs))
	mux.HandleFunc("GET /api/logs/services", h.Auth(h.LogServices))

	mux.HandleFunc("GET /api/heartbeats", h.Auth(h.Heartbeats))

	// SSE allows token in query string for EventSource (no headers possible)
	mux.HandleFunc("GET /api/stream", func(w http.ResponseWriter, r *http.Request) {
		// Allow ?token=... fallback so EventSource (browser) can authenticate.
		if r.URL.Query().Get("token") != "" {
			r.AddCookie(&http.Cookie{Name: "yagami_session", Value: r.URL.Query().Get("token")})
		}
		h.Auth(h.Stream)(w, r)
	})

	return chain(mux, requestLogger, recoverer)
}

func chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (sw *statusWriter) WriteHeader(c int) { sw.status = c; sw.ResponseWriter.WriteHeader(c) }

func (sw *statusWriter) Flush() {
	if sw.status == 0 {
		sw.status = 200
	}
	if f, ok := sw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (sw *statusWriter) Write(b []byte) (int, error) {
	if sw.status == 0 {
		sw.status = 200
	}
	n, err := sw.ResponseWriter.Write(b)
	sw.bytes += n
	return n, err
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w}
		next.ServeHTTP(sw, r)
		// don't log SSE keepalives noisily — only log final disconnect
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"bytes", sw.bytes,
			"dur_ms", time.Since(start).Milliseconds(),
		)
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				slog.Error("panic", "err", err, "path", r.URL.Path)
				http.Error(w, "internal error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
