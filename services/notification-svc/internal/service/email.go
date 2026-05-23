package service

import (
	"context"
	"os"
	"strconv"

	notiflib "github.com/pmplatform/libs/go/notification"
	"gopkg.in/gomail.v2"
)

// DialSender abstracts *gomail.Dialer for testing.
type DialSender interface {
	DialAndSend(msgs ...*gomail.Message) error
}

// EmailChannel delivers notifications via SMTP.
type EmailChannel struct {
	dialer DialSender
	from   string
}

// NewEmailChannelFromEnv reads SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM env vars.
// Returns (nil, nil) if SMTP_HOST is not set (graceful no-op — caller skips adding this channel).
func NewEmailChannelFromEnv() (*EmailChannel, error) {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		return nil, nil
	}
	port, _ := strconv.Atoi(os.Getenv("SMTP_PORT"))
	if port == 0 {
		port = 587
	}
	d := gomail.NewDialer(host, port, os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASSWORD"))
	// TLS: default true on port 465 (SSL); set SMTP_TLS=false to disable.
	if os.Getenv("SMTP_TLS") == "false" {
		d.SSL = false
	}
	return &EmailChannel{dialer: d, from: os.Getenv("SMTP_FROM")}, nil
}

func (c *EmailChannel) Name() string { return "email" }

// Send delivers ev via SMTP. The recipient address is taken from
// ev.Payload["to"]; if absent the event is a no-op (returns nil).
// ev.Payload["from_email"] overrides the default From address.
func (c *EmailChannel) Send(ctx context.Context, ev notiflib.Event) error {
	to, _ := ev.Payload["to"].(string)
	if to == "" {
		return nil
	}

	from := c.from
	if override, _ := ev.Payload["from_email"].(string); override != "" {
		from = override
	}

	m := gomail.NewMessage()
	m.SetHeader("From", from)
	m.SetHeader("To", to)
	m.SetHeader("Subject", ev.Title)
	m.SetBody("text/plain", ev.Body)

	return c.dialer.DialAndSend(m)
}
