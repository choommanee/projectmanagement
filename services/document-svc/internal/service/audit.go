package service

import (
	"context"

	"github.com/pmplatform/libs/go/audit"
)

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
//
// NOTE: this is the PLATFORM audit_log (compliance trail for document
// management mutations). It is entirely separate from the signing
// subsystem's hash-chained sign_event audit — do not conflate the two.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// WithAuditPublisher attaches the audit-log publisher; returns the receiver.
func (svc *Service) WithAuditPublisher(p AuditPublisher) *Service {
	svc.audit = p
	return svc
}

// EmitAudit writes one audit_log event best-effort; nil publisher or publish
// error is ignored so audit never blocks or fails the originating write.
func (svc *Service) EmitAudit(ctx context.Context, ev audit.Event) {
	if svc == nil || svc.audit == nil {
		return
	}
	if ev.Result == "" {
		ev.Result = "success"
	}
	_ = svc.audit.Publish(ctx, ev.Action, ev)
}
