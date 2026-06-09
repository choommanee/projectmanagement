// Package tsa implements an RFC 3161 Time-Stamp Protocol client used to
// anchor each signature record's chained_hash to a trusted third-party
// timestamp authority (default: https://freetsa.org/tsr).
//
// Failure posture: timestamping is best-effort. A TSA outage must NEVER block
// a signing ceremony — callers fall back to timestamp_source='local' (the
// server clock recorded in signed_at) and the row simply lacks third-party
// time attestation.
package tsa

import (
	"bytes"
	"context"
	"crypto"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/digitorus/timestamp"
)

// DefaultURL is the free public TSA used when TSA_URL is unset.
const DefaultURL = "https://freetsa.org/tsr"

// DefaultTimeout bounds the TSA round trip so signing latency stays sane.
const DefaultTimeout = 5 * time.Second

// Client requests RFC 3161 timestamp tokens over HTTP.
type Client struct {
	URL  string
	HTTP *http.Client
}

// New returns a client for the given TSA URL ("" → DefaultURL).
func New(url string) *Client {
	if url == "" {
		url = DefaultURL
	}
	return &Client{URL: url, HTTP: &http.Client{Timeout: DefaultTimeout}}
}

// FromEnv builds a client from TSA_URL. Setting TSA_URL=off (or "disabled")
// returns nil, which callers treat as "timestamping disabled".
func FromEnv() *Client {
	u := os.Getenv("TSA_URL")
	if u == "off" || u == "disabled" {
		return nil
	}
	return New(u)
}

// Timestamp requests a timestamp token over message (the SHA-256 message
// imprint is computed by the library). It returns the full DER-encoded
// TimeStampResp and the TSA's genTime.
func (c *Client) Timestamp(ctx context.Context, message []byte) (token []byte, genTime time.Time, err error) {
	if c == nil {
		return nil, time.Time{}, errors.New("tsa: client disabled")
	}
	tsq, err := timestamp.CreateRequest(bytes.NewReader(message), &timestamp.RequestOptions{
		Hash:         crypto.SHA256,
		Certificates: true,
	})
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("tsa: build request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(tsq))
	if err != nil {
		return nil, time.Time{}, err
	}
	req.Header.Set("Content-Type", "application/timestamp-query")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("tsa: request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, time.Time{}, fmt.Errorf("tsa: server returned %d", resp.StatusCode)
	}
	der, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, time.Time{}, err
	}
	ts, err := timestamp.ParseResponse(der)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("tsa: parse response: %w", err)
	}
	return der, ts.Time, nil
}

// VerifyResult reports how a stored token relates to a message.
type VerifyResult struct {
	Present        bool      `json:"present"`
	ImprintMatches bool      `json:"imprint_matches"`
	GenTime        time.Time `json:"gen_time,omitzero"`
	Error          string    `json:"error,omitempty"`
}

// Verify parses a stored DER TimeStampResp and checks that its message
// imprint equals hash(message) under the token's own hash algorithm.
// Note: this validates the binding between the token and the chained hash;
// full TSA certificate-chain validation against a trust store is a deploy-
// time concern (the freetsa root is not in the system trust store).
func Verify(token, message []byte) VerifyResult {
	if len(token) == 0 {
		return VerifyResult{Present: false}
	}
	ts, err := timestamp.ParseResponse(token)
	if err != nil {
		// Tolerate tokens stored as a bare TimeStampToken (ContentInfo).
		ts, err = timestamp.Parse(token)
		if err != nil {
			return VerifyResult{Present: true, Error: "unparseable token: " + err.Error()}
		}
	}
	if !ts.HashAlgorithm.Available() {
		return VerifyResult{Present: true, GenTime: ts.Time, Error: "unsupported hash algorithm"}
	}
	h := ts.HashAlgorithm.New()
	h.Write(message)
	digest := h.Sum(nil)
	return VerifyResult{
		Present:        true,
		ImprintMatches: bytes.Equal(digest, ts.HashedMessage),
		GenTime:        ts.Time,
	}
}
