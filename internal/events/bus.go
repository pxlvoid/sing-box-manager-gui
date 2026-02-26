package events

import (
	"encoding/json"
	"sync"
	"time"
)

// Event represents a single SSE event.
type Event struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// MarshalData returns JSON-encoded data field.
func (e *Event) MarshalData() []byte {
	b, _ := json.Marshal(e.Data)
	return b
}

// Subscriber receives events via a buffered channel.
type Subscriber struct {
	ID     string
	Events chan *Event
}

// Bus is an in-memory pub/sub event bus with fan-out to SSE subscribers.
type Bus struct {
	mu          sync.RWMutex
	subscribers map[string]*Subscriber
}

// NewBus creates a new event bus.
func NewBus() *Bus {
	return &Bus{
		subscribers: make(map[string]*Subscriber),
	}
}

// Subscribe creates a new subscriber with a buffered channel.
func (b *Bus) Subscribe(id string) *Subscriber {
	sub := &Subscriber{
		ID:     id,
		Events: make(chan *Event, 64),
	}
	b.mu.Lock()
	b.subscribers[id] = sub
	b.mu.Unlock()
	return sub
}

// Unsubscribe removes a subscriber and closes its channel.
func (b *Bus) Unsubscribe(id string) {
	b.mu.Lock()
	if sub, ok := b.subscribers[id]; ok {
		delete(b.subscribers, id)
		close(sub.Events)
	}
	b.mu.Unlock()
}

// Publish sends an event to all subscribers (non-blocking).
// If a subscriber's channel is full, the event is dropped for that subscriber.
func (b *Bus) Publish(eventType string, data interface{}) {
	event := &Event{
		Type: eventType,
		Data: data,
	}
	b.mu.RLock()
	for _, sub := range b.subscribers {
		select {
		case sub.Events <- event:
		default:
			// Drop event if subscriber is slow
		}
	}
	b.mu.RUnlock()
}

// PublishTimestamped is a convenience method that adds a timestamp to the data map.
func (b *Bus) PublishTimestamped(eventType string, data map[string]interface{}) {
	if data == nil {
		data = make(map[string]interface{})
	}
	data["timestamp"] = time.Now().Format(time.RFC3339)
	b.Publish(eventType, data)
}
