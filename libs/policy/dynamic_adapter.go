package policy

import (
	"sync/atomic"

	libauth "github.com/pmplatform/libs/go/auth"
)

// DynamicAdapter is a libauth.Authorizer-compatible holder that stores the
// active *Adapter behind an atomic pointer. This is what lets the
// /v1/admin/policy/reload endpoint swap the live bundle without restarting
// the service (mirrors the pattern in identity-svc's DynamicSigner).
//
// Construct via NewDynamicAdapter. The zero value behaves like a nil Adapter
// (deny-all) until Swap is called.
type DynamicAdapter struct {
	cur atomic.Pointer[Adapter]
}

// NewDynamicAdapter returns a holder seeded with the given initial adapter.
// initial may be nil, in which case every request is denied until Swap.
func NewDynamicAdapter(initial *Adapter) *DynamicAdapter {
	d := &DynamicAdapter{}
	if initial != nil {
		d.cur.Store(initial)
	}
	return d
}

// Swap atomically replaces the active adapter and returns the previous value
// (which may be nil if the holder was empty).
func (d *DynamicAdapter) Swap(next *Adapter) *Adapter {
	return d.cur.Swap(next)
}

// Current returns the currently-active adapter pointer (may be nil).
func (d *DynamicAdapter) Current() *Adapter {
	return d.cur.Load()
}

// IsAllowed delegates to the current adapter. A nil current pointer denies
// every request — same contract as Adapter.IsAllowed with a nil receiver.
func (d *DynamicAdapter) IsAllowed(r libauth.AuthzRequest) (bool, error) {
	a := d.cur.Load()
	if a == nil {
		return false, nil
	}
	return a.IsAllowed(r)
}
