package policy

import (
	_ "embed"
	"fmt"
	"os"
	"strings"

	libauth "github.com/pmplatform/libs/go/auth"
)

//go:embed bundle.cedar
var embeddedBundle string

// LoadBundle constructs an Engine from a Cedar source.
//
// When path is empty the embedded bundle.cedar is used; otherwise the file
// at path is read from disk (handy for ops to swap policies without a
// rebuild). The source is split into individual policies on the boundary
// between top-level `permit(...);` / `forbid(...);` statements so each can
// be added to the PolicySet under a unique name — cedar-go's
// Policy.UnmarshalCedar parses one statement at a time.
func LoadBundle(path string) (*Engine, error) {
	src := embeddedBundle
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read policy bundle %q: %w", path, err)
		}
		src = string(b)
	}
	if strings.TrimSpace(stripComments(src)) == "" {
		// Engine with empty policy set => deny-all, but explicit nil source
		// is almost certainly a misconfiguration.
		return nil, fmt.Errorf("policy bundle is empty")
	}
	stmts := splitPolicies(src)
	if len(stmts) == 0 {
		return nil, fmt.Errorf("policy bundle has no permit/forbid statements")
	}
	pol := make([]Policy, 0, len(stmts))
	for i, s := range stmts {
		pol = append(pol, Policy{Name: fmt.Sprintf("p%d", i), Body: s})
	}
	return New(pol)
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
			// Look for the start of a permit/forbid keyword at column boundary.
			if (c == 'p' && strings.HasPrefix(src[i:], "permit")) ||
				(c == 'f' && strings.HasPrefix(src[i:], "forbid")) {
				inStmt = true
				cur.WriteByte(c)
				continue
			}
			continue // skip whitespace / comments between statements
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

// Adapter wraps *Engine so it satisfies libs/go/auth.Authorizer without
// libs/go/auth needing to import Cedar.
type Adapter struct {
	E *Engine
}

// IsAllowed forwards to the wrapped Cedar engine. Returns (false, nil) when
// the engine is nil, which lets services run with the middleware bound but
// the engine intentionally absent (e.g. during a migration window).
func (a Adapter) IsAllowed(r libauth.AuthzRequest) (bool, error) {
	if a.E == nil {
		return false, nil
	}
	return a.E.IsAllowed(Request{
		Principal: r.Principal,
		Action:    r.Action,
		Resource:  r.Resource,
		Context:   r.Context,
	})
}
