// Package handlers — HTTP handlers grouped by feature.
package handlers

import (
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	natsx "yagami/api-gateway/internal/nats"
	"yagami/api-gateway/internal/store"
)

type Handler struct {
	Store *store.Store
	NC    *nats.Conn
	JS    jetstream.JetStream
	Bus   *natsx.Bus
}

func New(s *store.Store, nc *nats.Conn, js jetstream.JetStream, bus *natsx.Bus) *Handler {
	return &Handler{Store: s, NC: nc, JS: js, Bus: bus}
}
