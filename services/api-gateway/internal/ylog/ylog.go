// Package ylog publishes the API gateway's own logs to NATS so that
// the gateway shows up in the centralized log stream alongside everything
// else. It also writes to slog as before.
package ylog

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

var (
	mu      sync.Mutex
	nc      *nats.Conn
	service string
)

func Init(c *nats.Conn, svc string) {
	mu.Lock()
	defer mu.Unlock()
	nc = c
	service = svc
}

type entry struct {
	Ts      time.Time      `json:"ts"`
	Service string         `json:"service"`
	Level   string         `json:"level"`
	Message string         `json:"message"`
	Fields  map[string]any `json:"fields,omitempty"`
	Error   string         `json:"error,omitempty"`
}

func publish(level, msg string, fields map[string]any, err error) {
	mu.Lock()
	c, svc := nc, service
	mu.Unlock()
	if c == nil {
		return
	}
	e := entry{Ts: time.Now().UTC(), Service: svc, Level: level, Message: msg, Fields: fields}
	if err != nil {
		e.Error = err.Error()
	}
	b, _ := json.Marshal(e)
	_ = c.Publish("logs."+svc, b)
}

func Info(msg string, fields map[string]any) {
	slog.Info(msg, "fields", fields)
	publish("info", msg, fields, nil)
}
func Warn(msg string, fields map[string]any) {
	slog.Warn(msg, "fields", fields)
	publish("warn", msg, fields, nil)
}
func Error(msg string, err error, fields map[string]any) {
	slog.Error(msg, "error", err, "fields", fields)
	publish("error", msg, fields, err)
}
