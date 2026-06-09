package api

import (
	"net"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/quality-svc/internal/service"
)

// auditWrite records a successful mutation in the platform audit_log.
// Best-effort: never blocks or fails the request.
func auditWrite(svc *service.Service, r *http.Request, tid uuid.UUID, action, entityType, entityID string) {
	auditWriteMeta(svc, r, tid, action, entityType, entityID, nil)
}

func auditWriteMeta(svc *service.Service, r *http.Request, tid uuid.UUID, action, entityType, entityID string, meta map[string]any) {
	actor := ""
	if c, ok := libauth.FromCtx(r.Context()); ok {
		actor = c.Subject
	}
	svc.EmitAudit(r.Context(), audit.Event{
		TenantID:   tid.String(),
		UserID:     actor,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		IP:         clientIP(r),
		Result:     "success",
		Meta:       meta,
	})
}

// clientIP returns a clean IP (no port) for the audit_log.ip ::inet column.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if ip := strings.TrimSpace(strings.Split(xff, ",")[0]); net.ParseIP(ip) != nil {
			return ip
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && net.ParseIP(host) != nil {
		return host
	}
	if net.ParseIP(r.RemoteAddr) != nil {
		return r.RemoteAddr
	}
	return ""
}
