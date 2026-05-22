package auth

import (
	"context"
	"net/http"
	"strings"
)

// AuthzRequest describes an authorization question handed to an Authorizer.
// Fields mirror the (principal, action, resource, context) tuple used by
// policy engines like Cedar without forcing the libs/go/auth package to
// depend on any specific engine.
//
// ResourceAttrs (Plan #6 Task 6) carries per-instance entity attributes
// loaded via a ResourceLoader so Cedar policies can express ABAC predicates
// like `when { resource.tenant_id == context.tenant_id }`. Empty / nil when
// no loader is configured or for routes without a resource id.
type AuthzRequest struct {
	Principal     string
	Action        string
	Resource      string
	Context       map[string]any
	ResourceAttrs map[string]any
}

// ResourceLoader loads per-instance attributes for a Cedar resource UID, e.g.
// looking up `Project::"abc"` and returning `{tenant_id: "...", owner_user: "..."}`.
// Implementations live in each product service alongside its store so they can
// honor the RLS guarantees of that service (`SET LOCAL app.current_tenant`).
//
// Plan #6 Task 6 Step 1.
type ResourceLoader interface {
	LoadAttrs(ctx context.Context, uid string) (map[string]any, error)
}

// URLParam is the indirection libs/go/auth uses to extract path parameters
// without importing chi (which would force a dependency-graph change on the
// shared lib). Services that route via chi initialise this at startup with
// `libauth.URLParam = chi.URLParam`. When unset, templated resource scopes
// fall back to a literal `{:name}` placeholder, which yields a deterministic
// 403 — making misconfiguration loud rather than silent.
var URLParam = func(r *http.Request, key string) string { return "" }

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

// scopedOpts collects functional options for RequireActionScoped.
type scopedOpts struct {
	loader ResourceLoader
	mapper PrincipalMapper
}

// ScopedOption configures RequireActionScoped.
type ScopedOption func(*scopedOpts)

// WithLoader supplies a ResourceLoader so the middleware can populate
// AuthzRequest.ResourceAttrs from the service's store before evaluating
// the Cedar request. Pass nil to disable; the default is no loader.
func WithLoader(rl ResourceLoader) ScopedOption {
	return func(o *scopedOpts) { o.loader = rl }
}

// WithScopedPrincipalMapper overrides the principal mapping used by
// RequireActionScoped, mirroring RequireActionWithMapper for the scoped
// variant.
func WithScopedPrincipalMapper(m PrincipalMapper) ScopedOption {
	return func(o *scopedOpts) { o.mapper = m }
}

// RequireActionScoped returns middleware that authorizes the request the
// same way as RequireAction but resolves the resource UID from a template
// like `Project::{:id}` at request time. Path params inside `{:name}` are
// substituted via libauth.URLParam (which services initialise once in main).
//
// Templates without a `{:param}` placeholder are treated as literal UIDs, so
// `RequireActionScoped(authz, "tenant.sso.configure", "Tenant::*")` keeps the
// pre-ABAC wildcard semantics. Multiple placeholders are supported
// (e.g. `Sprint::{:id}` or `WorkflowTask::{:id}`).
//
// When a ResourceLoader is supplied via WithLoader the middleware calls it
// after substitution to populate AuthzRequest.ResourceAttrs so Cedar policies
// can express per-instance ABAC predicates (`resource.tenant_id == context.tenant_id`).
// Loader errors deny the request with 403 — failing closed is the
// correct posture for an authorization probe that can't reach its data.
//
// Backward compatibility: the existing RequireAction continues to wrap the
// resource as before and remains the convenient entrypoint for routes that
// have no id to bind (e.g. create endpoints).
func RequireActionScoped(authz Authorizer, action, template string, opts ...ScopedOption) func(http.Handler) http.Handler {
	o := scopedOpts{mapper: DefaultPrincipalMapper}
	for _, opt := range opts {
		opt(&o)
	}
	if o.mapper == nil {
		o.mapper = DefaultPrincipalMapper
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
			resource := resolveTemplate(r, template)
			ctxMap := map[string]any{
				"tenant_id": c.TenantID,
				"roles":     append([]string(nil), c.Roles...),
			}
			if v := r.Header.Get("X-Confirm-Destructive"); v != "" {
				switch v {
				case "true", "TRUE", "True", "1":
					ctxMap["confirm_destructive"] = true
				default:
					ctxMap["confirm_destructive"] = false
				}
			} else {
				ctxMap["confirm_destructive"] = false
			}
			var attrs map[string]any
			if o.loader != nil {
				a, err := o.loader.LoadAttrs(r.Context(), resource)
				if err != nil {
					// Fail closed: a loader that can't speak to its store is
					// indistinguishable from a missing resource for the
					// purposes of an ABAC decision.
					http.Error(w, "forbidden", http.StatusForbidden)
					return
				}
				attrs = a
			}
			req := AuthzRequest{
				Principal:     o.mapper(c),
				Action:        wrapUID("Action", action),
				Resource:      resource,
				Context:       ctxMap,
				ResourceAttrs: attrs,
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
			next.ServeHTTP(w, r)
		})
	}
}

// resolveTemplate substitutes `{:name}` placeholders in the template against
// path params extracted via the package-level URLParam hook. A template with
// no placeholders is returned as-is so callers can pass literal UIDs like
// `Resource::"*"` or `Tenant::*`.
func resolveTemplate(r *http.Request, template string) string {
	if !strings.Contains(template, "{:") {
		// Literal — preserve historic wildcard / fixed UID behaviour. Make
		// sure a bare `*` still serialises to a valid Cedar UID.
		return wrapResource(template)
	}
	out := template
	for {
		i := strings.Index(out, "{:")
		if i < 0 {
			break
		}
		j := strings.Index(out[i:], "}")
		if j < 0 {
			break
		}
		name := out[i+2 : i+j]
		val := URLParam(r, name)
		out = out[:i] + val + out[i+j+1:]
	}
	// Templates resolve to e.g. `Project::abc`. Cedar UIDs require quoted ids;
	// keep wrapUID's invariant by ensuring the id portion is double-quoted.
	if idx := strings.Index(out, "::"); idx > 0 {
		typeName := out[:idx]
		id := out[idx+2:]
		// Already-quoted ids (from a fully-qualified template) pass through.
		if strings.HasPrefix(id, `"`) && strings.HasSuffix(id, `"`) {
			return out
		}
		return typeName + `::"` + id + `"`
	}
	return out
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

