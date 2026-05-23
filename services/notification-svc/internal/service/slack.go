package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// SlackChannel delivers notifications via Slack Incoming Webhook (Block Kit).
type SlackChannel struct {
	client     *http.Client
	signingKey []byte
}

// NewSlackChannel creates a SlackChannel using the provided HTTP client and HMAC signing key.
func NewSlackChannel(client *http.Client, signingKey []byte) *SlackChannel {
	return &SlackChannel{client: client, signingKey: signingKey}
}

// Name returns the channel identifier.
func (c *SlackChannel) Name() string { return "slack" }

// Send delivers ev to the Slack webhook URL embedded in ev.Payload["slack_webhook_url"].
// If the URL is absent, Send returns nil (no-op).
func (c *SlackChannel) Send(_ context.Context, ev notiflib.Event) error {
	url, _ := ev.Payload["slack_webhook_url"].(string)
	if url == "" {
		return nil
	}

	msg := map[string]any{
		"blocks": []map[string]any{
			{
				"type": "section",
				"text": map[string]any{
					"type": "mrkdwn",
					"text": fmt.Sprintf("*%s*\n%s", ev.Title, ev.Body),
				},
			},
		},
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("slack: marshal payload: %w", err)
	}

	return postWithHMAC(c.client, url, c.signingKey, body, "application/json")
}
