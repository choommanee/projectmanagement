package audit

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	natsx "github.com/pmplatform/libs/go/nats"
)

func TestPublishConsumes(t *testing.T) {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = "nats://localhost:4222"
	}
	c, err := natsx.Connect(url)
	if err != nil {
		t.Skip(err)
	}
	defer c.Close()
	if err := c.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"}); err != nil {
		t.Fatal(err)
	}
	pub := NewPublisher(c, "test-svc")
	got := make(chan []byte, 1)
	_, _ = c.Subscribe(context.Background(), "AUDIT", "audit.test.x", func(d []byte) error { got <- d; return nil })
	if err := pub.Publish(context.Background(), "test.x", Event{
		TenantID: "t1", Action: "test.x", Result: "success",
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case msg := <-got:
		var ev Event
		_ = json.Unmarshal(msg, &ev)
		if ev.Action != "test.x" || ev.Service != "test-svc" {
			t.Fatalf("got %+v", ev)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout — no message")
	}
}
