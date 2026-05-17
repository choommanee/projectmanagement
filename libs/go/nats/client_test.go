package nats

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPublishAndSubscribe(t *testing.T) {
	url := os.Getenv("NATS_URL")
	if url == "" {
		url = "nats://localhost:4222"
	}
	c, err := Connect(url)
	if err != nil {
		t.Skipf("nats unavailable: %v", err)
	}
	defer c.Close()

	if err := c.EnsureStream(context.Background(), "TEST", []string{"test.>"}); err != nil {
		t.Fatal(err)
	}

	got := make(chan []byte, 1)
	_, err = c.Subscribe(context.Background(), "TEST", "test.x", func(data []byte) error {
		got <- data
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := c.Publish(context.Background(), "test.x", []byte("hello")); err != nil {
		t.Fatal(err)
	}

	select {
	case msg := <-got:
		if string(msg) != "hello" {
			t.Fatalf("unexpected: %s", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout")
	}
}
