package logger

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestNewWritesJSONWithLevel(t *testing.T) {
	var buf bytes.Buffer
	l := NewWithWriter(&buf, "debug")
	l.Info().Str("svc", "test").Msg("hello")

	var m map[string]any
	if err := json.Unmarshal(buf.Bytes(), &m); err != nil {
		t.Fatalf("not json: %v - %s", err, buf.String())
	}
	if m["message"] != "hello" || m["svc"] != "test" || m["level"] != "info" {
		t.Fatalf("unexpected: %v", m)
	}
}
