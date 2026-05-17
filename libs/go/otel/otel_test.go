package otel

import (
	"context"
	"testing"
)

func TestInitNoopWhenNoEndpoint(t *testing.T) {
	shutdown, err := Init(context.Background(), Config{ServiceName: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if shutdown == nil {
		t.Fatal("shutdown nil")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
