package service

import (
	"context"

	"github.com/pmplatform/libs/go/audit"
)

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
// Audit emission is a compliance side-effect — it must never block or fail the
// originating write, so EmitAudit swallows publisher errors.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// WithAuditPublisher attaches the audit-log publisher; returns the receiver for
// fluent wiring (mirrors WithNotifPublisher).
func (svc *Service) WithAuditPublisher(p AuditPublisher) *Service {
	svc.audit = p
	return svc
}

// EmitAudit writes one audit_log event best-effort. A nil publisher (tests that
// don't wire audit) or a publish error is silently ignored.
func (svc *Service) EmitAudit(ctx context.Context, ev audit.Event) {
	if svc == nil || svc.audit == nil {
		return
	}
	if ev.Result == "" {
		ev.Result = "success"
	}
	_ = svc.audit.Publish(ctx, ev.Action, ev)
}
