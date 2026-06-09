package domain

import (
	"testing"
	"time"
)

func TestMaskEmail(t *testing.T) {
	cases := map[string]string{
		"somchai@demo.co":  "s•••@d…",
		"a@b.io":           "a•••@b…",
		"fern@example.co":  "f•••@e…",
		"":                 "",
		"   ":              "",
		"no-at-sign":       "n•••",
		"@leading.invalid": "@•••", // malformed: keep first rune only
	}
	for in, want := range cases {
		if got := MaskEmail(in); got != want {
			t.Errorf("MaskEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestVerifyLinkUsable(t *testing.T) {
	now := time.Now().UTC()
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)

	if !(&VerifyLink{}).Usable(now) {
		t.Error("no expiry, not revoked: want usable")
	}
	if (&VerifyLink{RevokedAt: &past}).Usable(now) {
		t.Error("revoked: want unusable")
	}
	if (&VerifyLink{ExpiresAt: &past}).Usable(now) {
		t.Error("expired: want unusable")
	}
	if !(&VerifyLink{ExpiresAt: &future}).Usable(now) {
		t.Error("future expiry: want usable")
	}
}
