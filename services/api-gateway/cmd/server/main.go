// Package main — entry point for the API Gateway.
//
// LEARNING (Go):
//   - Every Go program starts with package main + func main().
//   - Go has NO exceptions. Errors are returned as values:
//     result, err := doSomething()
//     if err != nil { handle it }
//   - log/slog is Go's structured logging (added in Go 1.21).
//   - os.Signal + context for graceful shutdown is idiomatic Go.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"time"

	"yagami/api-gateway/internal/handlers"
	"yagami/api-gateway/internal/store"
)

func main() {
	// ── Structured logging ──────────────────────────────────
	// LEARNING: slog outputs JSON logs by default when using NewJSONHandler.
	// Every log entry has structured key-value pairs instead of free-form text.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// ── Database ────────────────────────────────────────────
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	db, err := store.New(context.Background(), dbURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	slog.Info("database connected")

	// ── HTTP routes ─────────────────────────────────────────
	// LEARNING: Go 1.22 added method-based routing to the stdlib.
	// Before 1.22, you needed a third-party router (chi, gorilla/mux).
	// Now "GET /path" patterns work natively with http.NewServeMux().
	h := handlers.New(db)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.Health)
	mux.HandleFunc("GET /api/events", h.ListEvents)
	mux.HandleFunc("GET /api/stats", h.Stats)

	// ── Server + graceful shutdown ──────────────────────────
	addr := ":8080"
	srv := &http.Server{Addr: addr, Handler: mux}

	// LEARNING: Goroutines are lightweight threads managed by the Go runtime.
	// go func() { ... }() spawns a new goroutine. Here we use one to listen
	// for SIGINT (Ctrl-C) and gracefully shut down the HTTP server.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt)
		<-sigCh // block until signal received

		slog.Info("shutting down...")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	slog.Info("API Gateway listening", "addr", addr)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
	slog.Info("goodbye")
}
