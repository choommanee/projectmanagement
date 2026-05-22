package auth

import (
	"net/http"
)

// AuthzRequest describes an authorization question handed to an Authorizer.
// Fields mirror the (principal, action, resource, context) tuple used by
// policy engines like Cedar without forcing the libs/go/auth package to
// depend on any specific engine.
type AuthzRequest struct {
	Principal string
	Action    string
	Resource  string
	Context   map[string]any
}

// Authorizer evaluates an AuthzRequest and returns true when permitted.
// Implementations must be safe for concurrent use.
type Authorizer interface {
	IsAllowed(AuthzRequest) (bool, error)
}

// PrincipalMapper turns a verified ParsedClaims into a Cedar-style principal
// entity UID string, e.g. User::"<subject>". Services may inject their own
// mapper if they want richer principal modeling (groups, etc.).
type PrincipalMapper func(*ParsedClaims) string

// DefaultPrincipalMapper renders a principal UID of the form User::"<sub>".
func DefaultPrincipalMapper(c *ParsedClaims) string {
	if c == nil {
		return ""
	}
	return `User::"` + c.Subject + `"`
}

// RequireAction returns middleware that authorizes the current request via
// the given Authorizer. It must be mounted AFTER Require (or any equivalent
// claim-injecting middleware) so ParsedClaims is present in context.
//
// The Cedar request is built from:
//   - principal: mapped from claims via DefaultPrincipalMapper
//   - action:    the supplied action string, wrapped as Action::"<name>"
//   - resource:  the supplied resource string; if it already contains '::'
//     it's used verbatim, otherwise wrapped as Resource::"<id>".
//   - context:   tenant_id + roles drawn from the JWT claims so policies can
//     scope decisions by tenant or check role membership.
//
// On deny the handler responds 403 forbidden; on engine error 500.
// When authz is nil the middleware is a no-op (useful in tests / bootstrap
// before the engine is loaded).
func RequireAction(authz Authorizer, action, resource string) func(http.Handler) http.Handler {
	return RequireActionWithMapper(authz, DefaultPrincipalMapper, action, resource)
}

// RequireActionWithMapper is the same as RequireAction but lets callers
// override how the principal UID is derived from claims.
func RequireActionWithMapper(authz Authorizer, mapper PrincipalMapper, action, resource string) func(http.Handler) http.Handler {
	if mapper == nil {
		mapper = DefaultPrincipalMapper
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if authz == nil {
				next.ServeHTTP(w, r)
				return
			}
			c, ok := FromCtx(r.Context())
			if !ok || c == nil {
				http.Error(w, "missing claims", http.StatusUnauthorized)
				return
			}
			ctx := map[string]any{
				"tenant_id": c.TenantID,
				"roles":     append([]string(nil), c.Roles...),
			}
			// Propagate the destructive-confirmation header into Cedar
			// context so policies guarding destructive actions (DELETE on
			// tenants/projects/workflows/work-orders, etc.) can require an
			// explicit opt-in. Header value is case-insensitive "true".
			if v := r.Header.Get("X-Confirm-Destructive"); v != "" {
				switch v {
				case "true", "TRUE", "True", "1":
					ctx["confirm_destructive"] = true
				default:
					ctx["confirm_destructive"] = false
				}
			} else {
				ctx["confirm_destructive"] = false
			}
			req := AuthzRequest{
				Principal: mapper(c),
				Action:    wrapUID("Action", action),
				Resource:  wrapResource(resource),
				Context:   ctx,
			}
			ok2, err := authz.IsAllowed(req)
			if err != nil {
				http.Error(w, "authz error", http.StatusInternalServerError)
				return
			}
			if !ok2 {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r.WithContext(r.Context()))
		})
	}
}

// wrapUID renders Type::"id". If the caller already passed a fully-qualified
// UID it is returned verbatim.
func wrapUID(typeName, id string) string {
	if containsSep(id) {
		return id
	}
	return typeName + `::"` + id + `"`
}

// wrapResource defaults to Resource::"<id>" but allows callers to pass a
// fully-qualified UID such as Project::"123" or the wildcard "*".
func wrapResource(id string) string {
	if id == "*" {
		return `Resource::"*"`
	}
	if containsSep(id) {
		return id
	}
	return `Resource::"` + id + `"`
}

func containsSep(s string) bool {
	for i := 0; i+1 < len(s); i++ {
		if s[i] == ':' && s[i+1] == ':' {
			return true
		}
	}
	return false
}

