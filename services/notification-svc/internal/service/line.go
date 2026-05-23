package service

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"time"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// LineChannel delivers notifications via LINE Notify webhook.
type LineChannel struct {
	client     *http.Client
	signingKey []byte
}

// NewLineChannel creates a LineChannel using the provided HTTP client and HMAC signing key.
func NewLineChannel(client *http.Client, signingKey []byte) *LineChannel {
	return &LineChannel{client: client, signingKey: signingKey}
}

// Name returns the channel identifier.
func (c *LineChannel) Name() string { return "line" }

// Send delivers ev to the LINE Notify URL embedded in ev.Payload["line_webhook_url"].
// The bearer token is read from ev.Payload["line_token"].
// If the URL is absent, Send returns nil (no-op).
func (c *LineChannel) Send(_ context.Context, ev notiflib.Event) error {
	webhookURL, _ := ev.Payload["line_webhook_url"].(string)
	if webhookURL == "" {
		return nil
	}
	token, _ := ev.Payload["line_token"].(string)

	form := url.Values{}
	form.Set("message", fmt.Sprintf("%s: %s", ev.Title, ev.Body))
	body := []byte(form.Encode())

	backoff := 100 * time.Millisecond
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}

		req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("line: build request: %w", err)
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if len(c.signingKey) > 0 {
			req.Header.Set("X-Pmplatform-Signature", signBody(c.signingKey, body))
		}

		resp, err := c.client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("line: do request: %w", err)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("line: server error %d", resp.StatusCode)
			continue
		}
		if resp.StatusCode >= 400 {
			return fmt.Errorf("line: client error %d", resp.StatusCode)
		}
		return nil
	}
	return lastErr
}
