// Package docsvc is a minimal stdlib HTTP client for document-svc, used by the
// signature poller to read sign-envelope status as a NATS-free fallback.
package docsvc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Envelope is the subset of document-svc's GET /v1/sign-envelopes/{id} response
// the poller cares about. document-svc emits snake_case JSON.
type Envelope struct {
	ID     uuid.UUID `json:"id"`
	Status string    `json:"status"` // draft|sent|completed|declined|voided|expired
}

// ErrNotFound is returned when document-svc replies 404 for an envelope.
var ErrNotFound = fmt.Errorf("docsvc: envelope not found")

// Client talks to document-svc over HTTP.
type Client struct {
	baseURL string
	http    *http.Client
}

// New builds a Client. baseURL defaults to http://localhost:8084 when empty.
func New(baseURL string) *Client {
	if baseURL == "" {
		baseURL = "http://localhost:8084"
	}
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 10 * time.Second},
	}
}

// GetEnvelope fetches sign-envelope detail. token is a service bearer token for
// the envelope's tenant; tenantID is propagated via X-Tenant-Id. A 404 maps to
// ErrNotFound; other non-200 statuses return an error so the caller can skip.
func (c *Client) GetEnvelope(ctx context.Context, token, tenantID string, envelopeID uuid.UUID) (*Envelope, error) {
	url := fmt.Sprintf("%s/v1/sign-envelopes/%s", c.baseURL, envelopeID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if tenantID != "" {
		req.Header.Set("X-Tenant-Id", tenantID)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrNotFound
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("docsvc: GET envelope %s: status %d: %s", envelopeID, resp.StatusCode, string(body))
	}

	var env Envelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("docsvc: decode envelope: %w", err)
	}
	return &env, nil
}
