package service

import (
	"context"

	"github.com/rs/zerolog/log"
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
