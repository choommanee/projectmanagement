package service

import (
	"context"

	notiflib "github.com/pmplatform/libs/go/notification"
)

// Channel delivers a notification via one delivery mechanism.
type Channel interface {
	Name() string
	Send(ctx context.Context, ev notiflib.Event) error
}
