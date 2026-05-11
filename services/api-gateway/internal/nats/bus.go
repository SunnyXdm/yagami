package nats

import (
	"sync"
)

// Bus is a tiny in-process pub/sub used to fan out NATS messages to all
// connected SSE clients. Each subscriber has its own buffered channel; a
// slow subscriber is dropped (latest-wins is more important than every-msg
// for a live feed).
type Bus struct {
	mu     sync.RWMutex
	subs   map[chan Event]struct{}
	bufLen int
}

type Event struct {
	Topic   string `json:"topic"`
	Payload []byte `json:"-"`
	JSON    string `json:"json"`
}

func NewBus() *Bus {
	return &Bus{subs: map[chan Event]struct{}{}, bufLen: 32}
}

func (b *Bus) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, b.bufLen)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		if _, ok := b.subs[ch]; ok {
			delete(b.subs, ch)
			close(ch)
		}
		b.mu.Unlock()
	}
}

func (b *Bus) Publish(e Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- e:
		default:
			// drop — slow consumer
		}
	}
}
