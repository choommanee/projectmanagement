package cert

import "time"

// TSALine is the per-signer RFC 3161 timestamp detail rendered on the
// Certificate of Completion, keyed by signer row id in Data.TSA.
type TSALine struct {
	GenTime time.Time
	Source  string // 'rfc3161' (token present) — 'local' rows render no line
}

// Line formats the certificate row.
func (t TSALine) Line() string {
	return "RFC 3161 token, gen time " + t.GenTime.UTC().Format(time.RFC3339)
}
