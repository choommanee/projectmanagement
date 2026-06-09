package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"
)

// ServiceTokenTTL is the lifetime of a minted service-to-service token. Kept
// deliberately short: long enough for a workflow node to fan out its calls,
// short enough that a leaked token is near-worthless. Callers (libs/go/serviceauth)
// refetch at ~80% of this.
const ServiceTokenTTL = 10 * time.Minute

// ServiceTokenRole is the single role embedded in every service token minted
// for the workflow runtime. It must match the role string the Cedar bundle
// grants in its `workflow-service` permit block.
const ServiceTokenRole = "workflow-service"

// ErrServiceTokenDisabled is returned when no SERVICE_TOKEN_SECRET is
// configured. The endpoint must surface this as a 503 so the s2s path is
// provably off rather than silently minting tokens with an empty secret.
var ErrServiceTokenDisabled = errors.New("service token endpoint disabled: SERVICE_TOKEN_SECRET not set")

// ErrServiceTokenForbidden is returned when the presented X-Service-Secret
// does not match the configured secret (constant-time compared).
var ErrServiceTokenForbidden = errors.New("invalid service secret")

// ServiceToken mints short-lived JWTs that let one backend service call
// another's Cedar-gated endpoints. The only new trust is the shared secret:
// callers on the internal network present it and receive a real JWT that
// downstream services verify through the normal JWKS path. The tenant is
// explicit in the token (no RLS bypass) and the role is fixed to
// ServiceTokenRole so the blast radius is exactly the Cedar permit grid.
type ServiceToken struct {
	signer TokenSigner
	secret string // SERVICE_TOKEN_SECRET; empty => endpoint disabled
	aud    AuditPublisher
}

// NewServiceToken builds the minter. An empty secret leaves the minter in a
// disabled state: Mint returns ErrServiceTokenDisabled and Enabled reports
// false so the router can decline to mount the endpoint.
func NewServiceToken(signer TokenSigner, secret string, aud AuditPublisher) *ServiceToken {
	return &ServiceToken{signer: signer, secret: secret, aud: aud}
}

// Enabled reports whether a secret is configured. The router uses this to
// 404/skip the endpoint entirely when s2s auth is not provisioned.
func (s *ServiceToken) Enabled() bool {
	return s != nil && s.secret != ""
}

// ServiceTokenInput is the (already-authenticated) request to mint a token.
type ServiceTokenInput struct {
	Service  string // logical name of the CALLING service, e.g. "workflow-svc"
	TenantID string // tenant the token will be scoped to (explicit, not derived)
}

// Mint validates the presented secret in constant time and, on success, signs
// a short-lived JWT with Subject="svc:<service>", the supplied tenant, and the
// fixed service role. It NEVER mints when the secret is unset.
func (s *ServiceToken) Mint(ctx context.Context, presentedSecret string, in ServiceTokenInput) (*TokenPair, error) {
	if !s.Enabled() {
		return nil, ErrServiceTokenDisabled
	}
	// Constant-time compare: avoids leaking secret length/prefix via timing.
	if subtle.ConstantTimeCompare([]byte(presentedSecret), []byte(s.secret)) != 1 {
		if s.aud != nil {
			_ = s.aud.Publish(ctx, "service.token.mint", audit.Event{
				TenantID: in.TenantID,
				UserID:   "svc:" + in.Service,
				Result:   "denied",
				Meta:     map[string]any{"service": in.Service, "reason": "bad_secret"},
			})
		}
		return nil, ErrServiceTokenForbidden
	}
	if in.Service == "" {
		return nil, errors.New("service required")
	}
	if _, err := uuid.Parse(in.TenantID); err != nil {
		return nil, errors.New("tenant_id must be a uuid")
	}

	access, err := s.signer.Sign(libauth.Claims{
		Subject:  "svc:" + in.Service,
		TenantID: in.TenantID,
		Roles:    []string{ServiceTokenRole},
		TTL:      ServiceTokenTTL,
	})
	if err != nil {
		return nil, err
	}

	if s.aud != nil {
		_ = s.aud.Publish(ctx, "service.token.mint", audit.Event{
			TenantID: in.TenantID,
			UserID:   "svc:" + in.Service,
			Result:   "success",
			Meta:     map[string]any{"service": in.Service, "role": ServiceTokenRole},
		})
	}

	return &TokenPair{
		AccessToken: access,
		ExpiresAt:   time.Now().Add(ServiceTokenTTL),
	}, nil
}
