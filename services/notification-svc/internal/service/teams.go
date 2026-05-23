package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// TeamsChannel delivers notifications via MS Teams Incoming Webhook.
type TeamsChannel struct {
	client     *http.Client
	signingKey []byte
}

// NewTeamsChannel creates a TeamsChannel using the provided HTTP client and HMAC signing key.
func NewTeamsChannel(client *http.Client, signingKey []byte) *TeamsChannel {
	return &TeamsChannel{client: client, signingKey: signingKey}
}

// Name returns the channel identifier.
func (c *TeamsChannel) Name() string { return "teams" }

// Send delivers ev to the MS Teams webhook URL embedded in ev.Payload["teams_webhook_url"].
// If the URL is absent, Send returns nil (no-op).
func (c *TeamsChannel) Send(_ context.Context, ev notiflib.Event) error {
	url, _ := ev.Payload["teams_webhook_url"].(string)
	if url == "" {
		return nil
	}

	card := map[string]any{
		"@type":    "MessageCard",
		"@context": "http://schema.org/extensions",
		"summary":  ev.Title,
		"text":     fmt.Sprintf("%s\n\n%s", ev.Title, ev.Body),
	}

	body, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("teams: marshal payload: %w", err)
	}

	return postWithHMAC(c.client, url, c.signingKey, body, "application/json")
}
