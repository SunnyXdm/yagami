# API Gateway — Go Learning Guide

## What This Service Owns

The Go gateway is the browser-facing control plane for Yagami.

It owns:

- session-based web auth
- setup and settings APIs
- Google OAuth start and callback handlers
- historical queries for activity, downloads, logs, and heartbeats
- the live SSE stream used by the frontend

## Concepts Worth Studying

### 1. Methods on a shared dependency struct

Go does not use classes here. Instead, handlers are methods on a struct that already holds the dependencies it needs.

```go
type Handler struct {
    Store *store.Store
    NC    *nats.Conn
}

func (h *Handler) ListEvents(w http.ResponseWriter, r *http.Request) { ... }
```

That receiver pattern is the Go equivalent of `this` or `self`.

Study:

- `internal/handlers/handler.go`
- `internal/handlers/api.go`
- `internal/handlers/settings.go`

### 2. Go 1.22 route patterns keep the router small

The project uses the standard library router directly:

```go
mux.HandleFunc("GET /api/events", h.Auth(h.ListEvents))
```

No third-party router is needed for this API surface.

Study:

- `internal/server/server.go`

### 3. Nullable database fields become pointer fields in JSON structs

The events and downloads APIs expose nullable columns with pointers:

```go
type Event struct {
    Title        *string `json:"title,omitempty"`
    ThumbnailURL *string `json:"thumbnail_url,omitempty"`
}
```

This matters because the UI needs to distinguish "missing" from "empty string".

Study:

- `internal/store/events.go`
- `internal/store/downloads.go`

### 4. Validation is mostly cheap and deterministic, with one live probe

`validate.go` does fast local validation for numbers, cookies, secrets, and extractor args. The only live network probe is the Telegram bot token check through `getMe`.

That pattern is deliberate: validate enough to catch common mistakes, but keep writes predictable and fast.

Study:

- `internal/handlers/validate.go`
- `internal/handlers/settings.go`

### 5. Historical queries and live streams are separate paths

The frontend does not get everything from SSE.

- REST endpoints fetch historical rows from Postgres.
- SSE carries live NATS fanout events.

That split keeps the UI responsive without forcing a "load the entire table" model.

Study:

- `internal/handlers/api.go`
- `internal/handlers/sse.go`
- `internal/store/events.go`
- `internal/store/logs.go`

### 6. Cursor pagination is simpler than offset pagination for append-only history

The gateway uses `after_id` style pagination for logs and events. For newest-first tables, that avoids offset drift while new rows are being inserted.

Study:

- `internal/store/events.go`
- `internal/store/logs.go`

### 7. Settings masking and readiness summaries live in the API layer

The gateway is where secrets are masked for normal reads and where setup readiness is turned into a per-feature status map for the UI.

Study:

- `internal/handlers/settings.go`

### 8. Graceful shutdown and background fanout are still plain Go

`main.go` wires Postgres, NATS, JetStream setup, log/heartbeat sinks, and graceful shutdown without extra frameworks.

Study:

- `cmd/server/main.go`

## Current Patterns In This Repo

- Google OAuth redirects are fixed to localhost, not whatever host served the page.
- Saving settings publishes `system.config_changed` so other services reload.
- The UI combines historical REST data with live SSE updates.
- Missing event thumbnails can be safely backfilled from `video_id` in the store layer.

## File Map

```text
cmd/server/main.go                entrypoint, NATS setup, graceful shutdown
internal/server/server.go         routes and middleware
internal/handlers/api.go          events, downloads, stats, logs, heartbeats
internal/handlers/settings.go     masking, readiness, config updates
internal/handlers/validate.go     field validation and Telegram token probe
internal/handlers/sse.go          live SSE stream
internal/store/events.go          activity queries and thumbnail hydration
internal/store/logs.go            structured log queries
internal/store/youtube_sync.go    OAuth-triggered YouTube baseline resets
```

## Run And Verify

```bash
cd services/api-gateway
go test ./...
```

Useful focused checks:

```bash
go test ./internal/handlers
go test ./internal/store
```

## Go-Specific Gotchas

1. Handle every `error`; ignoring one is almost always the real bug.
2. Remember that `nil` pointers in JSON structs mean "field absent", not "empty".
3. Avoid over-abstracting handlers. In this repo, explicit code is usually clearer than generic helper layers.
4. For append-only history, prefer cursor pagination to offsets.

## Resources

- [Effective Go](https://go.dev/doc/effective_go)
- [Go by Example](https://gobyexample.com/)
- [Standard library docs](https://pkg.go.dev/std)
