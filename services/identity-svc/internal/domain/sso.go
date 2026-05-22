package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// SSO sentinel errors. Surfaced at the API layer:
//   * NotFound          → 404 (admin GET / lookup miss)
//   * Disabled          → 503 ("SSO not configured") when SSO_MASTER_KEY is empty
//   * StateInvalid      → 400 (callback state JWT failed verification / expired)
//   * JITDisabled       → 403 (IdP authenticated user is unknown AND
//                              allow_jit_provisioning = false)
//   * UnsupportedProto  → 400 (admin POST with provider != 'oidc')
var (
	ErrSSOConfigNotFound        = errors.New("sso config not found")
	ErrSSODisabled              = errors.New("sso not configured")
	ErrSSOStateInvalid          = errors.New("sso state invalid")
	ErrSSOJITDisabled           = errors.New("sso jit provisioning disabled")
	ErrSSOUnsupportedProtocol   = errors.New("sso unsupported protocol")
	ErrSSOIDTokenInvalid        = errors.New("sso id_token invalid")
	ErrSSOMissingEmail          = errors.New("sso id_token missing email claim")
)

// SSOConfig mirrors the sso_config row. ClientSecretEncrypted is the raw
// AES-GCM ciphertext (nonce || ciphertext) — callers must decrypt before
// passing the secret to the OIDC client.
//
// AttributeMap is the JSON map of (internal_attr → idp_claim_key). When a key
// is missing we fall back to the standard OIDC claim name.
type SSOConfig struct {
	ID                     uuid.UUID
	TenantID               uuid.UUID
	Provider               string
	IssuerURL              string
	ClientID               string
	ClientSecretEncrypted  []byte
	RedirectURI            string
	Scopes                 []string
	AttributeMap           map[string]string
	AllowJITProvisioning   bool
	DefaultRole            string // empty = no default role assignment
	Enabled                bool
	CreatedAt              time.Time
	UpdatedAt              time.Time
}

// AttrKey returns the IdP claim name for the given internal attribute,
// falling back to the standard OIDC claim names when AttributeMap has no
// override. Keeps the OIDC service free of "if mapped else default" sprawl.
func (c *SSOConfig) AttrKey(internal string) string {
	if c != nil && c.AttributeMap != nil {
		if v, ok := c.AttributeMap[internal]; ok && v != "" {
			return v
		}
	}
	switch internal {
	case "email":
		return "email"
	case "name":
		return "name"
	case "groups":
		return "groups"
	case "sub":
		return "sub"
	}
	return internal
}
