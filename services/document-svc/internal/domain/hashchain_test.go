package domain

import "testing"

func TestCanonicalContentHashStableAcrossKeyOrder(t *testing.T) {
	a := map[string]any{"type": "doc", "content": []any{map[string]any{"a": 1, "b": 2}}}
	b := map[string]any{"content": []any{map[string]any{"b": 2, "a": 1}}, "type": "doc"}
	if CanonicalContentHash(a) != CanonicalContentHash(b) {
		t.Fatal("hash should be stable across map key order")
	}
}

func TestCanonicalContentHashDetectsChange(t *testing.T) {
	a := map[string]any{"type": "doc", "content": []any{"hello"}}
	b := map[string]any{"type": "doc", "content": []any{"hello world"}}
	if CanonicalContentHash(a) == CanonicalContentHash(b) {
		t.Fatal("hash should differ when content changes")
	}
}

func TestChainHashDeterministicAndChained(t *testing.T) {
	c1 := ChainHash("", "content1", "signer1", "2026-01-01T00:00:00Z", "session", "Alice")
	c1b := ChainHash("", "content1", "signer1", "2026-01-01T00:00:00Z", "session", "Alice")
	if c1 != c1b {
		t.Fatal("chain hash must be deterministic")
	}
	c2 := ChainHash(c1, "content1", "signer2", "2026-01-02T00:00:00Z", "session", "Bob")
	// Tampering with prev hash must change the result.
	c2tampered := ChainHash("tampered", "content1", "signer2", "2026-01-02T00:00:00Z", "session", "Bob")
	if c2 == c2tampered {
		t.Fatal("chained hash must depend on prev hash")
	}
}
