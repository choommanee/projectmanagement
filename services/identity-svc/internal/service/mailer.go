package service

import (
	"context"

	"github.com/rs/zerolog/log"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// Mailer is the minimal interface PasswordReset uses to deliver a reset
// link. A real SMTP / SES / notif-svc adapter lands in Plan #7; until
// then LogMailer writes the message to the service log so dev + tests
// can read the link off stdout.
type Mailer interface {
	Send(ctx context.Context, to, subject, body string) error
}

// LogMailer is the placeholder implementation. It logs the message at
// INFO level using the project logger so the reset link is visible in
// `go run` output and captured by structured logging downstream.
type LogMailer struct{}

func NewLogMailer() *LogMailer { return &LogMailer{} }

func (LogMailer) Send(ctx context.Context, to, subject, body string) error {
	log.Info().
		Str("to", to).
		Str("subject", subject).
		Str("body", body).
		Msg("mailer.send (LogMailer)")
	return nil
}

// NotifSvcMailer implements Mailer by publishing to notification-svc via NATS.
// Identity-svc publishes a notiflib.Event with Kind="system.email" and
// Payload containing "to" — notification-svc picks it up and routes to the
// email channel. TenantID and UserID are set to the "system" sentinel because
// password-reset emails are issued before a session exists; the email channel
// only uses Payload["to"] and ignores those fields.
type NotifSvcMailer struct {
	pub notiflib.Publisher
}

func NewNotifSvcMailer(pub notiflib.Publisher) *NotifSvcMailer {
	return &NotifSvcMailer{pub: pub}
}

func (m *NotifSvcMailer) Send(ctx context.Context, to, subject, body string) error {
	return m.pub.Publish(ctx, notiflib.Event{
		TenantID: "system",
		UserID:   "system",
		Kind:     "system.email",
		Title:    subject,
		Body:     body,
		Payload: map[string]any{
			"to": to,
		},
	})
}
