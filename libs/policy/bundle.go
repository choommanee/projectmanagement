// Package policy is the shared Cedar policy bundle for all pmplatform
// services. It owns the canonical bundle.cedar source and exposes both a
// loader and an Authorizer adapter so any service can wire Cedar into its
// HTTP stack without re-implementing the splitter / loader.
//
// Typical use from a service main:
//
//	ps, err := policy.LoadShared()
//	if err != nil { log.Fatal(err) }
//	authz := &policy.Adapter{Policies: ps}
//	h := api.NewRouter(..., authz)
//
// The bundle is embedded by default; setting POLICY_BUNDLE_PATH=/some/file
// swaps in a disk-loaded source so operators can iterate on policies without
// rebuilding the binary. Plan #4 Task 6 will add DB-backed loading on top of
// this same Adapter.
package policy

import (
	_ "embed"
	"fmt"
	"os"
	"strings"

	cedar "github.com/cedar-policy/cedar-go"
	cedartypes "github.com/cedar-policy/cedar-go/types"

	libauth "github.com/pmplatform/libs/go/auth"
)

//go:embed bundle.cedar
var embeddedBundle string

// LoadShared parses the shared Cedar bundle into a PolicySet.
//
// Source resolution: when POLICY_BUNDLE_PATH is set the file at that path is
// read; otherwise the embedded bundle.cedar is used. The source is split into
// individual `permit(...);` / `forbid(...);` statements (cedar-go's
// Policy.UnmarshalCedar parses one statement at a time) and each is added to
// the PolicySet under a unique generated ID.
func LoadShared() (*cedar.PolicySet, error) {
	src := embeddedBundle
	if path := os.Getenv("POLICY_BUNDLE_PATH"); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read policy bundle %q: %w", path, err)
		}
		src = string(b)
	}
	if strings.TrimSpace(stripComments(src)) == "" {
		return nil, fmt.Errorf("policy bundle is empty")
	}
	stmts := splitPolicies(src)
	if len(stmts) == 0 {
		return nil, fmt.Errorf("policy bundle has no permit/forbid statements")
	}
	ps := cedar.NewPolicySet()
	for i, s := range stmts {
		var cp cedar.Policy
		if err := cp.UnmarshalCedar([]byte(s)); err != nil {
			return nil, fmt.Errorf("policy p%d: %w", i, err)
		}
		ps.Add(cedartypes.PolicyID(fmt.Sprintf("p%d", i)), &cp)
	}
	return ps, nil
}

// LoadSharedFromPath ignores POLICY_BUNDLE_PATH and loads from the given file.
// Pass "" to force the embedded bundle. Useful in tests.
func LoadSharedFromPath(path string) (*cedar.PolicySet, error) {
	src := embeddedBundle
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read policy bundle %q: %w", path, err)
		}
		src = string(b)
	}
	if strings.TrimSpace(stripComments(src)) == "" {
		return nil, fmt.Errorf("policy bundle is empty")
	}
	stmts := splitPolicies(src)
	if len(stmts) == 0 {
		return nil, fmt.Errorf("policy bundle has no permit/forbid statements")
	}
	ps := cedar.NewPolicySet()
	for i, s := range stmts {
		var cp cedar.Policy
		if err := cp.UnmarshalCedar([]byte(s)); err != nil {
			return nil, fmt.Errorf("policy p%d: %w", i, err)
		}
		ps.Add(cedartypes.PolicyID(fmt.Sprintf("p%d", i)), &cp)
	}
	return ps, nil
}

// Adapter wraps a *cedar.PolicySet so it satisfies libauth.Authorizer
// without libs/go/auth needing to import Cedar. A nil Policies field denies
// every request, which lets services run with the middleware bound while the
// bundle is intentionally absent (e.g. during a migration window).
type Adapter struct {
	Policies *cedar.PolicySet
}

// IsAllowed evaluates the request against the wrapped PolicySet. Returns
// (false, nil) when Policies is nil.
func (a *Adapter) IsAllowed(r libauth.AuthzRequest) (bool, error) {
	if a == nil || a.Policies == nil {
		return false, nil
	}
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
	entities := cedartypes.EntityMap{}
	decision, _ := a.Policies.IsAuthorized(entities, req)
	return decision == cedar.Allow, nil
}

// stripComments removes Cedar `//` line comments so splitPolicies can scan
// statements without false positives inside commented-out blocks.
func stripComments(s string) string {
	var out strings.Builder
	for _, line := range strings.Split(s, "\n") {
		if i := strings.Index(line, "//"); i >= 0 {
			line = line[:i]
		}
		out.WriteString(line)
		out.WriteByte('\n')
	}
	return out.String()
}

// splitPolicies splits a Cedar source containing multiple top-level
// permit/forbid statements into individual policy strings. The grammar is
// simple enough that we can rely on tracking paren depth + the terminating
// semicolon at depth 0.
func splitPolicies(src string) []string {
	src = stripComments(src)
	var out []string
	var cur strings.Builder
	depth := 0
	inStmt := false
	flush := func() {
		s := strings.TrimSpace(cur.String())
		if s != "" {
			out = append(out, s)
		}
		cur.Reset()
	}
	for i := 0; i < len(src); i++ {
		c := src[i]
		if !inStmt {
			if (c == 'p' && strings.HasPrefix(src[i:], "permit")) ||
				(c == 'f' && strings.HasPrefix(src[i:], "forbid")) {
				inStmt = true
				cur.WriteByte(c)
				continue
			}
			continue
		}
		cur.WriteByte(c)
		switch c {
		case '(':
			depth++
		case ')':
			depth--
		case '{':
			depth++
		case '}':
			depth--
		case ';':
			if depth == 0 {
				flush()
				inStmt = false
			}
		}
	}
	flush()
	return out
}

// parseEntityUID parses a Cedar entity UID string of the form Type::"id".
func parseEntityUID(s string) (cedartypes.EntityUID, error) {
	idx := strings.Index(s, `::"`)
	if idx < 0 || !strings.HasSuffix(s, `"`) {
		return cedartypes.EntityUID{}, fmt.Errorf("invalid entity UID %q: expected Type::\"id\" format", s)
	}
	typeName := s[:idx]
	id := s[idx+3 : len(s)-1]
	return cedar.NewEntityUID(cedartypes.EntityType(typeName), cedartypes.String(id)), nil
}

// buildContext converts a map[string]any into a Cedar Record. Supports
// strings, booleans, integers, and []string (mapped to Cedar Set of strings).
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
