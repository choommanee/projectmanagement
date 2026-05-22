// Package policy provides a minimal Cedar policy engine facade so the rest of
// the codebase can ask "is principal X allowed to do action Y on resource Z?"
// without depending on Cedar's API directly.
package policy

import (
	"fmt"
	"strings"

	cedar "github.com/cedar-policy/cedar-go"
	cedartypes "github.com/cedar-policy/cedar-go/types"
)

// Policy holds a named Cedar policy document.
type Policy struct {
	Name string
	Body string
}

// Request describes an authorization question.
// Principal, Action, and Resource are Cedar entity UID strings in the form
// Type::"id", e.g. User::"alice".
type Request struct {
	Principal string
	Action    string
	Resource  string
	Context   map[string]any
}

// Engine evaluates Cedar authorization requests against a fixed policy set.
type Engine struct {
	ps *cedar.PolicySet
}

// New constructs an Engine from the given policies.
// Passing nil or an empty slice creates an engine that denies every request.
func New(policies []Policy) (*Engine, error) {
	ps := cedar.NewPolicySet()
	for _, p := range policies {
		var cp cedar.Policy
		if err := cp.UnmarshalCedar([]byte(p.Body)); err != nil {
			return nil, fmt.Errorf("policy %q: %w", p.Name, err)
		}
		ps.Add(cedartypes.PolicyID(p.Name), &cp)
	}
	return &Engine{ps: ps}, nil
}

// IsAllowed returns true if the Cedar policy set permits the request.
// It returns false (deny) for any request not explicitly permitted.
func (e *Engine) IsAllowed(r Request) (bool, error) {
	principal, err := parseEntityUID(r.Principal)
	if err != nil {
		return false, fmt.Errorf("principal: %w", err)
	}
	action, err := parseEntityUID(r.Action)
	if err != nil {
		return false, fmt.Errorf("action: %w", err)
	}
	resource, err := parseEntityUID(r.Resource)
	if err != nil {
		return false, fmt.Errorf("resource: %w", err)
	}

	ctx, err := buildContext(r.Context)
	if err != nil {
		return false, fmt.Errorf("context: %w", err)
	}

	req := cedar.Request{
		Principal: principal,
		Action:    action,
		Resource:  resource,
		Context:   ctx,
	}

	// Use an empty entity map; entity attributes are not needed for simple UID matching.
	entities := cedartypes.EntityMap{}
	decision, _ := e.ps.IsAuthorized(entities, req)
	return decision == cedar.Allow, nil
}

// parseEntityUID parses a Cedar entity UID string of the form Type::"id".
// For example: User::"alice" → type=User, id=alice.
func parseEntityUID(s string) (cedartypes.EntityUID, error) {
	// Format expected: TypeName::"identifier"
	idx := strings.Index(s, `::"`)
	if idx < 0 || !strings.HasSuffix(s, `"`) {
		return cedartypes.EntityUID{}, fmt.Errorf("invalid entity UID %q: expected Type::\"id\" format", s)
	}
	typeName := s[:idx]
	// Extract the id between the inner quotes.
	id := s[idx+3 : len(s)-1]
	return cedar.NewEntityUID(cedartypes.EntityType(typeName), cedartypes.String(id)), nil
}

// buildContext converts a map[string]any into a Cedar Record.
// Supports strings, booleans, integers, and []string (mapped to Cedar Set
// of strings so policies can write `context.roles.contains("platform-admin")`).
func buildContext(m map[string]any) (cedartypes.Record, error) {
	rm := make(cedartypes.RecordMap, len(m))
	for k, v := range m {
		switch val := v.(type) {
		case string:
			rm[cedartypes.String(k)] = cedartypes.String(val)
		case bool:
			rm[cedartypes.String(k)] = cedartypes.Boolean(val)
		case int:
			rm[cedartypes.String(k)] = cedartypes.Long(val)
		case int64:
			rm[cedartypes.String(k)] = cedartypes.Long(val)
		case []string:
			items := make([]cedartypes.Value, 0, len(val))
			for _, s := range val {
				items = append(items, cedartypes.String(s))
			}
			rm[cedartypes.String(k)] = cedartypes.NewSet(items...)
		default:
			// Skip unsupported types rather than failing.
		}
	}
	return cedar.NewRecord(rm), nil
}
