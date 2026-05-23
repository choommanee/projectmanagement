package service

import (
	"context"
	"testing"

	notiflib "github.com/pmplatform/libs/go/notification"
	"gopkg.in/gomail.v2"
)

// fakeDialSender records messages passed to DialAndSend.
type fakeDialSender struct {
	called   bool
	messages []*gomail.Message
	err      error
}

func (f *fakeDialSender) DialAndSend(msgs ...*gomail.Message) error {
	f.called = true
	f.messages = append(f.messages, msgs...)
	return f.err
}

func TestEmailChannel_Send(t *testing.T) {
	fake := &fakeDialSender{}
	ch := &EmailChannel{dialer: fake, from: "sender@example.com"}

	ev := notiflib.Event{
		Kind:  "system.email",
		Title: "Hello subject",
		Body:  "Hello body",
		Payload: map[string]any{
			"to": "user@example.com",
		},
	}

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !fake.called {
		t.Fatal("expected DialAndSend to be called")
	}
	if len(fake.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(fake.messages))
	}

	m := fake.messages[0]
	buf := &headerCapture{}
	m.WriteTo(buf) //nolint:errcheck // write to bytes for header inspection

	// Inspect via GetHeader.
	if got := m.GetHeader("To"); len(got) == 0 || got[0] != "user@example.com" {
		t.Errorf("To: got %v, want [user@example.com]", got)
	}
	if got := m.GetHeader("Subject"); len(got) == 0 || got[0] != "Hello subject" {
		t.Errorf("Subject: got %v, want [Hello subject]", got)
	}
	if got := m.GetHeader("From"); len(got) == 0 || got[0] != "sender@example.com" {
		t.Errorf("From: got %v, want [sender@example.com]", got)
	}
}

// headerCapture is an io.Writer that discards bytes; only used to trigger WriteTo.
type headerCapture struct{}

func (h *headerCapture) Write(p []byte) (int, error) { return len(p), nil }

func TestEmailChannel_NoRecipient(t *testing.T) {
	fake := &fakeDialSender{}
	ch := &EmailChannel{dialer: fake, from: "sender@example.com"}

	ev := notiflib.Event{
		Kind:    "system.email",
		Title:   "Hello",
		Body:    "Body",
		Payload: map[string]any{}, // no "to"
	}

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected nil on no-recipient, got: %v", err)
	}
	if fake.called {
		t.Fatal("expected DialAndSend NOT to be called when to is missing")
	}
}

func TestEmailChannel_FromPayloadOverride(t *testing.T) {
	fake := &fakeDialSender{}
	ch := &EmailChannel{dialer: fake, from: "default@example.com"}

	ev := notiflib.Event{
		Kind:  "system.email",
		Title: "Override from",
		Body:  "Body",
		Payload: map[string]any{
			"to":         "user@example.com",
			"from_email": "custom@example.com",
		},
	}

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fake.messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(fake.messages))
	}
	if got := fake.messages[0].GetHeader("From"); len(got) == 0 || got[0] != "custom@example.com" {
		t.Errorf("From override: got %v, want [custom@example.com]", got)
	}
}
