package audit

import "context"

// PublishFn is the common signature for any audit publisher.
type PublishFn func(ctx context.Context, action string, ev Event) error

// Fallback composes two publishers — primary, then fallback on nil or error.
type Fallback struct {
	primary  PublishFn
	fallback PublishFn
}

// NewFallback creates a composite publisher that tries primary first.
// If primary is nil or returns an error, fallback is tried.
func NewFallback(primary, fallback PublishFn) *Fallback {
	return &Fallback{primary: primary, fallback: fallback}
}

// Publish tries primary publisher; on nil/failure falls through to fallback.
func (f *Fallback) Publish(ctx context.Context, action string, ev Event) error {
	if f.primary != nil {
		if err := f.primary(ctx, action, ev); err == nil {
			return nil
		}
	}
	if f.fallback != nil {
		return f.fallback(ctx, action, ev)
	}
	return nil
}
