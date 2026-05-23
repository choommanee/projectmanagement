package service

import (
	"context"
	"testing"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// fakeNotifPublisher is an in-test Publisher that records published events.
type fakeNotifPublisher struct {
	events []notiflib.Event
	err    error
}

func (f *fakeNotifPublisher) Publish(_ context.Context, ev notiflib.Event) error {
	f.events = append(f.events, ev)
	return f.err
}

func TestNotifSvcMailer_PublishesSystemEmail(t *testing.T) {
	pub := &fakeNotifPublisher{}
	m := NewNotifSvcMailer(pub)

	err := m.Send(context.Background(), "user@example.com", "Password reset", "Click here: https://example.com/reset?token=abc")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(pub.events) != 1 {
		t.Fatalf("expected 1 published event, got %d", len(pub.events))
	}

	ev := pub.events[0]
	if ev.Kind != "system.email" {
		t.Errorf("Kind: got %q, want %q", ev.Kind, "system.email")
	}
	if ev.Title != "Password reset" {
		t.Errorf("Title: got %q, want %q", ev.Title, "Password reset")
	}
	if ev.Body != "Click here: https://example.com/reset?token=abc" {
		t.Errorf("Body: got %q", ev.Body)
	}
	if to, _ := ev.Payload["to"].(string); to != "user@example.com" {
		t.Errorf("Payload[to]: got %q, want %q", to, "user@example.com")
	}
}
