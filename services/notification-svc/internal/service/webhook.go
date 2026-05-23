package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"
)

// signBody computes HMAC-SHA256 of body with key and returns hex string.
func signBody(key []byte, body []byte) string {
	mac := hmac.New(sha256.New, key)
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// postWithHMAC marshals body, signs it, adds X-Pmplatform-Signature header, and POSTs.
// Retries up to 3 times on HTTP 5xx with exponential backoff (100ms, 200ms, 400ms).
func postWithHMAC(client *http.Client, url string, signingKey []byte, body []byte, contentType string) error {
	backoff := 100 * time.Millisecond
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			time.Sleep(backoff)
			backoff *= 2
		}

		req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("webhook: build request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		if len(signingKey) > 0 {
			req.Header.Set("X-Pmplatform-Signature", signBody(signingKey, body))
		}

		resp, err := client.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("webhook: do request: %w", err)
			continue
		}
		resp.Body.Close()

		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("webhook: server error %d", resp.StatusCode)
			continue
		}

		if resp.StatusCode >= 400 {
			return fmt.Errorf("webhook: client error %d", resp.StatusCode)
		}

		return nil
	}
	return lastErr
}
