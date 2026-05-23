package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// testEvent returns a populated Event with the given extra payload fields.
func testEvent(extra map[string]any) notiflib.Event {
	p := map[string]any{
		"some": "data",
	}
	for k, v := range extra {
		p[k] = v
	}
	return notiflib.Event{
		ID:       "test-id",
		TenantID: "00000000-0000-0000-0000-000000000001",
		UserID:   "00000000-0000-0000-0000-000000000002",
		Kind:     "test.event",
		Title:    "Hello World",
		Body:     "This is a test notification",
		Payload:  p,
		Timestamp: time.Now(),
	}
}

var testKey = []byte("test-signing-key")

// expectedSig returns the HMAC-SHA256 hex for given body and test key.
func expectedSig(body []byte) string {
	return signBody(testKey, body)
}

// ---------- Teams ----------

func TestTeamsChannel_Send_NoURL(t *testing.T) {
	ch := NewTeamsChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(nil) // no teams_webhook_url
	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected no-op nil, got %v", err)
	}
}

func TestTeamsChannel_Send_Payload(t *testing.T) {
	var captured struct {
		req  *http.Request
		body []byte
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.req = r
		captured.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewTeamsChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(map[string]any{"teams_webhook_url": srv.URL})

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("Send error: %v", err)
	}

	// Content-Type
	if ct := captured.req.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	// Signature
	wantSig := expectedSig(captured.body)
	gotSig := captured.req.Header.Get("X-Pmplatform-Signature")
	if gotSig != wantSig {
		t.Errorf("X-Pmplatform-Signature = %q, want %q", gotSig, wantSig)
	}

	// Payload shape
	var card map[string]any
	if err := json.Unmarshal(captured.body, &card); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if card["@type"] != "MessageCard" {
		t.Errorf("@type = %v, want MessageCard", card["@type"])
	}
	if card["summary"] != ev.Title {
		t.Errorf("summary = %v, want %q", card["summary"], ev.Title)
	}
	textVal, _ := card["text"].(string)
	if !strings.Contains(textVal, ev.Title) || !strings.Contains(textVal, ev.Body) {
		t.Errorf("text %q missing title/body", textVal)
	}
}

func TestTeamsChannel_Send_Retry(t *testing.T) {
	var callCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := callCount.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewTeamsChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(map[string]any{"teams_webhook_url": srv.URL})

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if n := callCount.Load(); n != 3 {
		t.Errorf("expected 3 attempts, got %d", n)
	}
}

// ---------- Slack ----------

func TestSlackChannel_Send_NoURL(t *testing.T) {
	ch := NewSlackChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(nil)
	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected no-op nil, got %v", err)
	}
}

func TestSlackChannel_Send_Payload(t *testing.T) {
	var captured struct {
		req  *http.Request
		body []byte
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.req = r
		captured.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewSlackChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(map[string]any{"slack_webhook_url": srv.URL})

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("Send error: %v", err)
	}

	if ct := captured.req.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}

	wantSig := expectedSig(captured.body)
	gotSig := captured.req.Header.Get("X-Pmplatform-Signature")
	if gotSig != wantSig {
		t.Errorf("X-Pmplatform-Signature = %q, want %q", gotSig, wantSig)
	}

	// Block Kit structure
	var msg map[string]any
	if err := json.Unmarshal(captured.body, &msg); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	blocks, ok := msg["blocks"].([]any)
	if !ok || len(blocks) == 0 {
		t.Fatal("blocks missing or empty")
	}
	block, _ := blocks[0].(map[string]any)
	if block["type"] != "section" {
		t.Errorf("block type = %v, want section", block["type"])
	}
	text, _ := block["text"].(map[string]any)
	if text["type"] != "mrkdwn" {
		t.Errorf("text.type = %v, want mrkdwn", text["type"])
	}
	textVal, _ := text["text"].(string)
	if !strings.Contains(textVal, ev.Title) || !strings.Contains(textVal, ev.Body) {
		t.Errorf("text %q missing title/body", textVal)
	}
}

func TestSlackChannel_Send_Retry(t *testing.T) {
	var callCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := callCount.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewSlackChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(map[string]any{"slack_webhook_url": srv.URL})

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if n := callCount.Load(); n != 3 {
		t.Errorf("expected 3 attempts, got %d", n)
	}
}

// ---------- LINE ----------

func TestLineChannel_Send_NoURL(t *testing.T) {
	ch := NewLineChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(nil)
	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected no-op nil, got %v", err)
	}
}

func TestLineChannel_Send_Payload(t *testing.T) {
	var captured struct {
		req  *http.Request
		body []byte
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured.req = r
		captured.body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	const lineToken = "my-line-token"
	ch := NewLineChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(map[string]any{
		"line_webhook_url": srv.URL,
		"line_token":       lineToken,
	})

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("Send error: %v", err)
	}

	// Content-Type
	if ct := captured.req.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
		t.Errorf("Content-Type = %q, want application/x-www-form-urlencoded", ct)
	}

	// Authorization header
	authHeader := captured.req.Header.Get("Authorization")
	if authHeader != "Bearer "+lineToken {
		t.Errorf("Authorization = %q, want Bearer %s", authHeader, lineToken)
	}

	// Signature
	wantSig := expectedSig(captured.body)
	gotSig := captured.req.Header.Get("X-Pmplatform-Signature")
	if gotSig != wantSig {
		t.Errorf("X-Pmplatform-Signature = %q, want %q", gotSig, wantSig)
	}

	// Form body
	vals, err := url.ParseQuery(string(captured.body))
	if err != nil {
		t.Fatalf("parse form body: %v", err)
	}
	msgVal := vals.Get("message")
	if !strings.Contains(msgVal, ev.Title) || !strings.Contains(msgVal, ev.Body) {
		t.Errorf("message %q missing title/body", msgVal)
	}
}

func TestLineChannel_Send_Retry(t *testing.T) {
	var callCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := callCount.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ch := NewLineChannel(&http.Client{Timeout: 5 * time.Second}, testKey)
	ev := testEvent(map[string]any{
		"line_webhook_url": srv.URL,
		"line_token":       "tok",
	})

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("expected success after retries, got %v", err)
	}
	if n := callCount.Load(); n != 3 {
		t.Errorf("expected 3 attempts, got %d", n)
	}
}

// ---------- signBody ----------

func TestSignBody(t *testing.T) {
	key := []byte("secret")
	body := []byte("hello world")
	sig1 := signBody(key, body)
	sig2 := signBody(key, body)
	if sig1 != sig2 {
		t.Error("signBody not deterministic")
	}
	if len(sig1) != 64 {
		t.Errorf("expected 64 hex chars (SHA256), got %d", len(sig1))
	}
	// Different key → different sig
	sig3 := signBody([]byte("other"), body)
	if sig1 == sig3 {
		t.Error("expected different sig for different key")
	}
}
