// Package serviceauth is the client other Go services embed to obtain a
// short-lived service-to-service bearer token from identity-svc.
//
// The token authorizes one backend service to call another's Cedar-gated
// endpoints (e.g. workflow-svc -> document-svc) by minting a real JWT
// (verified through the normal JWKS path) that carries a service role and an
// explicit tenant. The only new trust is the shared secret presented to
// identity-svc's POST /v1/internal/service-token endpoint; see that handler
// for the security rationale.
//
// Tokens are cached per tenant and proactively refetched once ~80% of their
// lifetime has elapsed, so callers never pay the network round-trip on the
// hot path and never present a token that is about to expire mid-flight.
package serviceauth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// refreshFraction is the portion of a token's TTL after which we treat the
// cached token as stale and refetch. 0.8 leaves a comfortable margin before
// the real expiry so an in-flight downstream call cannot race the boundary.
const refreshFraction = 0.8

// defaultTimeout bounds a single token-minting round-trip to identity-svc.
const defaultTimeout = 5 * time.Second

// Client mints and caches service-to-service tokens for a single calling
// service. It is safe for concurrent use by multiple goroutines.
type Client struct {
	identityURL string // base URL of identity-svc, e.g. http://localhost:8082
	secret      string // shared secret presented as X-Service-Secret
	service     string // logical name of THIS service, e.g. "workflow-svc"
	httpClient  *http.Client

	// now is injectable so tests can drive the cache expiry deterministically.
	now func() time.Time

	mu    sync.Mutex
	cache map[string]cachedToken // keyed by tenant id
}

type cachedToken struct {
	token     string
	refreshAt time.Time // when we proactively refetch (~80% of TTL)
	expiresAt time.Time // hard expiry reported by identity-svc
}

// New builds a Client. identityURL is the base URL of identity-svc (trailing
// slash optional), secret is the shared SERVICE_TOKEN_SECRET, and service is
// the logical name of the CALLING service (used as the requested principal,
// e.g. "workflow-svc").
func New(identityURL, secret, service string) *Client {
	return &Client{
		identityURL: strings.TrimRight(identityURL, "/"),
		secret:      secret,
		service:     service,
		httpClient:  &http.Client{Timeout: defaultTimeout},
		now:         time.Now,
		cache:       make(map[string]cachedToken),
	}
}

// WithHTTPClient overrides the default HTTP client (e.g. to point at an
// httptest server or inject a custom transport). Returns the receiver for
// fluent wiring.
func (c *Client) WithHTTPClient(h *http.Client) *Client {
	c.httpClient = h
	return c
}

// TokenFor returns a bearer token (without the "Bearer " prefix) for the
// given tenant. It serves a cached token until ~80% of its TTL has elapsed,
// then mints a fresh one. Concurrent callers for the same tenant may both
// trigger a fetch under contention; that is harmless (identity-svc is
// idempotent) and avoids holding the lock across the network call.
func (c *Client) TokenFor(ctx context.Context, tenantID string) (string, error) {
	if tenantID == "" {
		return "", fmt.Errorf("serviceauth: empty tenant id")
	}

	c.mu.Lock()
	entry, ok := c.cache[tenantID]
	c.mu.Unlock()
	if ok && c.now().Before(entry.refreshAt) {
		return entry.token, nil
	}

	fresh, err := c.fetch(ctx, tenantID)
	if err != nil {
		// On refetch failure, fall back to a still-valid cached token rather
		// than failing the downstream call outright. Only the hard expiry is
		// a real wall.
		if ok && c.now().Before(entry.expiresAt) {
			return entry.token, nil
		}
		return "", err
	}

	c.mu.Lock()
	c.cache[tenantID] = fresh
	c.mu.Unlock()
	return fresh.token, nil
}

type tokenRequest struct {
	Service  string `json:"service"`
	TenantID string `json:"tenant_id"`
}

type tokenResponse struct {
	AccessToken string    `json:"access_token"`
	ExpiresAt   time.Time `json:"expires_at"`
}

func (c *Client) fetch(ctx context.Context, tenantID string) (cachedToken, error) {
	body, err := json.Marshal(tokenRequest{Service: c.service, TenantID: tenantID})
	if err != nil {
		return cachedToken{}, err
	}
	url := c.identityURL + "/v1/internal/service-token"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return cachedToken{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Secret", c.secret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return cachedToken{}, fmt.Errorf("serviceauth: request identity-svc: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return cachedToken{}, fmt.Errorf("serviceauth: identity-svc returned %d: %s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return cachedToken{}, fmt.Errorf("serviceauth: decode token response: %w", err)
	}
	if tr.AccessToken == "" {
		return cachedToken{}, fmt.Errorf("serviceauth: identity-svc returned empty access_token")
	}

	now := c.now()
	ttl := tr.ExpiresAt.Sub(now)
	if ttl <= 0 {
		// identity-svc should always return a future expiry; guard against a
		// clock skew / malformed response by treating the token as immediately
		// stale so we never cache something already dead.
		ttl = time.Minute
	}
	return cachedToken{
		token:     tr.AccessToken,
		refreshAt: now.Add(time.Duration(float64(ttl) * refreshFraction)),
		expiresAt: tr.ExpiresAt,
	}, nil
}
