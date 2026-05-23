package notification

import (
	"context"
	"testing"
)

func TestPublish_Validation(t *testing.T) {
	cases := []struct {
		name string
		ev   Event
		want string
	}{
		{"missing tenant", Event{UserID: "u", Kind: "k", Title: "t"}, "tenant_id"},
		{"missing user", Event{TenantID: "t", Kind: "k", Title: "t"}, "user_id"},
		{"missing kind", Event{TenantID: "t", UserID: "u", Title: "t"}, "kind"},
		{"missing title", Event{TenantID: "t", UserID: "u", Kind: "k"}, "title"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := Publish(context.Background(), nil, tc.ev)
			if err == nil {
				t.Fatalf("expected validation error, got nil")
			}
		})
	}
}

func TestPublish_NilClient(t *testing.T) {
	err := Publish(context.Background(), nil, Event{
		TenantID: "t", UserID: "u", Kind: "k", Title: "t",
	})
	if err == nil {
		t.Fatal("expected error for nil client")
	}
}
