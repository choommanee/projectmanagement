package notification

import (
	"context"
	"os"
	"testing"

	natsx "github.com/pmplatform/libs/go/nats"
)

// TestNoopPublisher_AlwaysNil verifies that NoopPublisher.Publish returns nil
// for any event, including those that would fail JetStreamPublisher validation.
// (This replaces the removed free-function Publish tests.)
func TestNoopPublisher_AlwaysNil(t *testing.T) {
	var p Publisher = NoopPublisher{}
	cases := []struct {
		name string
		ev   Event
	}{
		{"missing tenant", Event{UserID: "u", Kind: "k", Title: "t"}},
		{"missing user", Event{TenantID: "t", Kind: "k", Title: "t"}},
		{"missing kind", Event{TenantID: "t", UserID: "u", Title: "t"}},
		{"missing title", Event{TenantID: "t", UserID: "u", Kind: "k"}},
		{"fully valid", Event{TenantID: "t", UserID: "u", Kind: "k", Title: "hi"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := p.Publish(context.Background(), tc.ev); err != nil {
				t.Fatalf("NoopPublisher.Publish returned non-nil error: %v", err)
			}
		})
	}
}

// TestNoopPublisher verifies that NoopPublisher always returns nil regardless
// of the event contents.
func TestNoopPublisher(t *testing.T) {
	var p Publisher = NoopPublisher{}

	cases := []Event{
		// fully valid
		{TenantID: "tid", UserID: "uid", Kind: "task.assigned", Title: "Hello"},
		// intentionally missing required fields — noop must not validate
		{},
		{TenantID: "tid"},
	}
	for _, ev := range cases {
		if err := p.Publish(context.Background(), ev); err != nil {
			t.Fatalf("NoopPublisher.Publish returned non-nil error: %v", err)
		}
	}
}

// TestNewJetStreamPublisher_NilClient verifies the constructor rejects a nil client.
func TestNewJetStreamPublisher_NilClient(t *testing.T) {
	_, err := NewJetStreamPublisher(nil)
	if err == nil {
		t.Fatal("expected error for nil client, got nil")
	}
}

// TestJetStreamPublisher_Validation verifies field validation via a real NATS
// client. The test is skipped when NATS is unavailable (same pattern as
// libs/go/nats/client_test.go).
func TestJetStreamPublisher_Validation(t *testing.T) {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = "nats://localhost:4222"
	}
	c, err := natsx.Connect(url)
	if err != nil {
		t.Skipf("nats unavailable: %v", err)
	}
	defer c.Close()

	p, err := NewJetStreamPublisher(c)
	if err != nil {
		t.Fatalf("NewJetStreamPublisher: %v", err)
	}

	cases := []struct {
		name string
		ev   Event
	}{
		{"missing tenant", Event{UserID: "u", Kind: "k", Title: "t"}},
		{"missing user", Event{TenantID: "t", Kind: "k", Title: "t"}},
		{"missing kind", Event{TenantID: "t", UserID: "u", Title: "t"}},
		{"missing title", Event{TenantID: "t", UserID: "u", Kind: "k"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := p.Publish(context.Background(), tc.ev)
			if err == nil {
				t.Fatalf("expected validation error for %s, got nil", tc.name)
			}
		})
	}
}
