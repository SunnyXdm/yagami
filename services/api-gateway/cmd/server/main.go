// Package main — Yagami API Gateway entrypoint.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"yagami/api-gateway/internal/handlers"
	natsx "yagami/api-gateway/internal/nats"
	"yagami/api-gateway/internal/server"
	"yagami/api-gateway/internal/store"
	yagamilog "yagami/api-gateway/internal/ylog"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	dbURL := getenv("DATABASE_URL", "postgres://yagami:yagami@postgres:5432/yagami")
	natsURL := getenv("NATS_URL", "nats://nats:4222")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, err := store.New(ctx, dbURL)
	if err != nil {
		slog.Error("db connect failed", "error", err)
		os.Exit(1)
	}
	defer st.Close()
	slog.Info("database connected")

	nc, js, err := natsx.Connect(natsURL)
	if err != nil {
		slog.Error("nats connect failed", "error", err)
		os.Exit(1)
	}
	defer nc.Drain() //nolint:errcheck
	slog.Info("nats connected", "url", natsURL)

	if err := natsx.EnsureStreams(js); err != nil {
		slog.Error("jetstream ensure streams failed", "error", err)
		os.Exit(1)
	}
	slog.Info("jetstream streams ready")

	// Background workers — log sink, heartbeat sink, event fanout for SSE
	bus := natsx.NewBus()
	go natsx.RunLogSink(ctx, js, st)
	go natsx.RunHeartbeatSink(ctx, js, st)
	go natsx.RunEventFanout(ctx, js, bus)

	// Publish our own logs to NATS (so we appear in the dashboard too)
	yagamilog.Init(nc, "api-gateway")

	// Self heartbeat so the api-gateway appears alive in the UI.
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		publish := func() {
			payload := []byte(`{"status":"ok","version":"1.0.0","service":"api-gateway"}`)
			_ = nc.Publish("system.heartbeat", payload)
		}
		publish()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				publish()
			}
		}
	}()

	h := handlers.New(st, nc, js, bus)
	srv := server.New(h)

	httpSrv := &http.Server{
		Addr:              ":8080",
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		<-sig
		slog.Info("shutting down...")
		cancel()
		shutdownCtx, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = httpSrv.Shutdown(shutdownCtx)
	}()

	slog.Info("API Gateway listening", "addr", ":8080")
	if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
