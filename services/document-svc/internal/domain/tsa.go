package domain

import "time"

// TSAVerify reports RFC 3161 trusted-timestamp verification for one chain
// link (signature record). Present=false means the row was signed without a
// TSA token (timestamp_source='local' — TSA unreachable or disabled).
type TSAVerify struct {
	Present        bool       `json:"present"`
	ImprintMatches bool       `json:"imprint_matches"`
	GenTime        *time.Time `json:"gen_time,omitempty"`
	Source         string     `json:"source"` // 'rfc3161' | 'local'
	Error          string     `json:"error,omitempty"`
}
