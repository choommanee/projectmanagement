package api

import (
	"net"
	"net/http"
	"strings"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/tenant-svc/internal/service"
)

// emitAudit records a successful mutation in the audit_log table. It NEVER
// fails the request: a nil publisher or any publish error is swallowed so
// auditing can never break a write path.
//
// Tenant resolution order: JWT claims -> X-Tenant-Id header -> (for tenant
// entities only) the affected tenant id itself. The last fallback matters for
// `tenant.create`, which can legitimately run before the caller has a tenant
// context — the audit row is then scoped to the newly created tenant.
func emitAudit(svc *service.Service, r *http.Request, action, entityType, entityID string, before, after map[string]any) {
	if svc == nil || svc.Audit == nil {
		return
	}
	var tid, uid string
	if c, ok := libauth.FromCtx(r.Context()); ok && c != nil {
		uid = c.Subject
		tid = c.TenantID
	}
	if tid == "" {
		tid = r.Header.Get("X-Tenant-Id")
	}
	if tid == "" && entityType == "tenant" {
		tid = entityID
	}
	if tid == "" {
		return
	}
	_ = svc.Audit.Publish(r.Context(), action, audit.Event{
		TenantID:   tid,
		UserID:     uid,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		IP:         clientIP(r),
		Result:     "success",
		Before:     before,
		After:      after,
	})
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		if net.ParseIP(r.RemoteAddr) != nil {
			return r.RemoteAddr
		}
		return ""
	}
	return host
}
