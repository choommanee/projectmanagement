package domain

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// Verify-link lifecycle audit-event kinds (migration 00010). They ride the
// same tamper-evident event hash chain as every other sign event.
const (
	EvVerifyLinkCreated  SignEventType = "verify_link_created"
	EvVerifyLinkAccessed SignEventType = "verify_link_accessed"
	EvVerifyLinkRevoked  SignEventType = "verify_link_revoked"
)

// VerifyLink is a public-verification share link for a signing envelope.
// Only the SHA-256 hash of the raw token is persisted; the raw token is
// returned exactly once at creation time and never again.
type VerifyLink struct {
	ID             uuid.UUID  `json:"id"`
	TenantID       uuid.UUID  `json:"tenant_id"`
	EnvelopeID     uuid.UUID  `json:"envelope_id"`
	CreatedBy      *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	RevokedAt      *time.Time `json:"revoked_at,omitempty"`
	AccessCount    int        `json:"access_count"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
}

// Usable reports whether the link can still resolve a public report.
func (l *VerifyLink) Usable(now time.Time) bool {
	if l.RevokedAt != nil {
		return false
	}
	if l.ExpiresAt != nil && now.After(*l.ExpiresAt) {
		return false
	}
	return true
}

// PublicVerifyReport is the SAFE external subset of a verification run.
// Deliberately excluded: signer emails (masked instead), IP addresses,
// user agents, document content, tenant/document/signer UUIDs. The envelope
// id is exposed only as an 8-char short id for support correlation.
type PublicVerifyReport struct {
	EnvelopeShortID string               `json:"envelope_short_id"`
	DocumentTitle   string               `json:"document_title"`
	Status          EnvelopeStatus       `json:"status"`
	SigningOrder    SigningOrder         `json:"signing_order"`
	CompletedAt     *time.Time           `json:"completed_at,omitempty"`
	Signers         []PublicSignerReport `json:"signers"`
	Checks          PublicChainChecks    `json:"checks"`
	Valid           bool                 `json:"valid"`
	Reason          string               `json:"reason,omitempty"`
	DocumentHash    string               `json:"document_hash,omitempty"` // hex SHA-256 of the signed content
	CertificateOK   bool                 `json:"certificate_available"`
	VerifiedAt      time.Time            `json:"verified_at"`
}

// PublicSignerReport is the per-signer slice of the public report.
type PublicSignerReport struct {
	DisplayName string          `json:"display_name"`
	EmailMasked string          `json:"email_masked,omitempty"`
	Status      SignatureStatus `json:"status"`
	SignedAt    *time.Time      `json:"signed_at,omitempty"`
	AuthMethod  AuthMethod      `json:"auth_method"`
}

// PublicChainChecks summarizes the three tamper-evidence layers.
type PublicChainChecks struct {
	RecordChainValid  bool             `json:"record_chain_valid"`
	EventChain        EventChainStatus `json:"event_chain"`
	RecordSignatures  string           `json:"record_signatures"` // "valid" | "invalid" | "absent"
	SignedSignerCount int              `json:"signed_signer_count"`
}

// MaskEmail reduces an email to a non-identifying hint: first rune of the
// local part + "•••@" + first rune of the domain + "…". Examples:
// "somchai@demo.co" -> "s•••@d…". Empty input stays empty.
func MaskEmail(email string) string {
	email = strings.TrimSpace(email)
	if email == "" {
		return ""
	}
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 {
		// malformed — mask everything except the first rune
		r := []rune(email)
		return string(r[0]) + "•••"
	}
	local := []rune(email[:at])
	domain := []rune(email[at+1:])
	return string(local[0]) + "•••@" + string(domain[0]) + "…"
}
