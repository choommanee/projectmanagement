package service

import (
	"context"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// WithVerifyLinks attaches the public verify-link store; fluent wiring.
func (svc *Service) WithVerifyLinks(v *store.VerifyLinks) *Service {
	svc.VerifyLinks = v
	return svc
}

// CreateVerifyLinkInput holds params for minting a public verification link.
type CreateVerifyLinkInput struct {
	TenantID   uuid.UUID
	EnvelopeID uuid.UUID
	CreatedBy  *uuid.UUID
	ExpiresAt  *time.Time // nil = no expiry
}

// CreateVerifyLink mints a public verification link for a COMPLETED envelope.
// The raw token is returned exactly once; only its SHA-256 hash is stored.
func (svc *Service) CreateVerifyLink(ctx context.Context, in CreateVerifyLinkInput, am AuditMeta) (*domain.VerifyLink, string, error) {
	env, err := svc.Signatures.GetEnvelope(ctx, in.TenantID, in.EnvelopeID)
	if err != nil {
		return nil, "", err
	}
	// Defense-in-depth tenant check: RLS already scopes the read in prod
	// (non-owner role), but dev runs as the table owner where RLS is
	// bypassed — never mint a link against another tenant's envelope.
	if env.TenantID != in.TenantID {
		return nil, "", domain.ErrNotFound
	}
	if env.Status != domain.EnvCompleted {
		return nil, "", domain.ErrInvalidInput // public validity reports only exist for completed envelopes
	}
	raw, hash, err := store.NewVerifyToken()
	if err != nil {
		return nil, "", err
	}
	link, err := svc.VerifyLinks.Create(ctx, in.TenantID, in.EnvelopeID, hash, in.CreatedBy, in.ExpiresAt)
	if err != nil {
		return nil, "", err
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: in.TenantID, EnvelopeID: in.EnvelopeID, EventType: domain.EvVerifyLinkCreated,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"link_id": link.ID.String()},
	})
	return link, raw, nil
}

// RevokeVerifyLink revokes a link so the public URL 404s from now on.
func (svc *Service) RevokeVerifyLink(ctx context.Context, tid, envID, linkID uuid.UUID, am AuditMeta) (*domain.VerifyLink, error) {
	link, err := svc.VerifyLinks.Revoke(ctx, tid, envID, linkID)
	if err != nil {
		return nil, err
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: envID, EventType: domain.EvVerifyLinkRevoked,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"link_id": linkID.String()},
	})
	return link, nil
}

// resolveUsableLink maps a raw public token to a usable link or ErrNotFound.
// Unknown, revoked, and expired tokens are deliberately indistinguishable
// (all 404) and the miss path costs one indexed SELECT — rate-limit friendly.
func (svc *Service) resolveUsableLink(ctx context.Context, rawToken string) (*domain.VerifyLink, error) {
	if rawToken == "" || len(rawToken) > 128 {
		return nil, domain.ErrNotFound
	}
	link, err := svc.VerifyLinks.ResolveByTokenHash(ctx, store.HashVerifyToken(rawToken))
	if err != nil {
		return nil, err
	}
	if !link.Usable(time.Now().UTC()) {
		return nil, domain.ErrNotFound
	}
	return link, nil
}

// PublicVerify resolves a raw token and produces the safe external validity
// report: it reuses the SAME VerifyChain logic as the authenticated endpoint,
// then projects only non-sensitive fields (masked emails, no IPs/UUIDs/body).
// Each successful report increments access_count and appends a
// verify_link_accessed event to the envelope's tamper-evident audit chain.
func (svc *Service) PublicVerify(ctx context.Context, rawToken string, am AuditMeta) (*domain.PublicVerifyReport, error) {
	link, err := svc.resolveUsableLink(ctx, rawToken)
	if err != nil {
		return nil, err
	}
	// Tenant context comes from the resolved link; all reads below are
	// normal RLS-scoped paths.
	env, err := svc.Signatures.GetEnvelope(ctx, link.TenantID, link.EnvelopeID)
	if err != nil {
		return nil, err
	}
	chain, err := svc.VerifyChain(ctx, link.TenantID, link.EnvelopeID)
	if err != nil {
		return nil, err
	}

	report := &domain.PublicVerifyReport{
		EnvelopeShortID: env.ID.String()[:8],
		DocumentTitle:   env.Title,
		Status:          env.Status,
		SigningOrder:    env.SigningOrder,
		CompletedAt:     env.CompletedAt,
		Valid:           chain.Valid,
		Reason:          chain.Reason,
		CertificateOK:   env.Status == domain.EnvCompleted,
		VerifiedAt:      time.Now().UTC(),
	}

	// Per-signer safe subset. Display name: signer_name, else masked email,
	// else positional label. NEVER raw emails, IPs, or UUIDs.
	for i, s := range env.Signers {
		name := s.SignerName
		if name == "" {
			name = domain.MaskEmail(s.SignerEmail)
		}
		if name == "" {
			name = "Signer " + strconv.Itoa(i+1)
		}
		report.Signers = append(report.Signers, domain.PublicSignerReport{
			DisplayName: name,
			EmailMasked: domain.MaskEmail(s.SignerEmail),
			Status:      s.Status,
			SignedAt:    s.SignedAt,
			AuthMethod:  s.AuthMethod,
		})
		if s.Status == domain.SigSigned {
			report.DocumentHash = s.ContentHash // hex SHA-256 of the signed content
		}
	}

	// Chain-check breakdown.
	recordChainValid := true
	sigState := "absent"
	signed := 0
	for _, l := range chain.Links {
		signed++
		if !l.ContentMatches || !l.ChainMatches {
			recordChainValid = false
		}
		if l.RecordSigValid != nil {
			if !*l.RecordSigValid {
				sigState = "invalid"
			} else if sigState == "absent" {
				sigState = "valid"
			}
		}
	}
	report.Checks = domain.PublicChainChecks{
		RecordChainValid:  recordChainValid && len(chain.Links) > 0,
		EventChain:        chain.EventChain,
		RecordSignatures:  sigState,
		SignedSignerCount: signed,
	}

	// Access accounting + audit event (best-effort; the report still serves).
	_ = svc.VerifyLinks.IncrementAccess(ctx, link.TenantID, link.ID)
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: link.TenantID, EnvelopeID: link.EnvelopeID, EventType: domain.EvVerifyLinkAccessed,
		IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"link_id": link.ID.String(), "valid": chain.Valid},
	})
	return report, nil
}

// PublicCertificate serves the Certificate of Completion PDF for a valid
// public token — the same bytes the authenticated route returns.
func (svc *Service) PublicCertificate(ctx context.Context, rawToken string) ([]byte, error) {
	link, err := svc.resolveUsableLink(ctx, rawToken)
	if err != nil {
		return nil, err
	}
	return svc.GetCertificate(ctx, link.TenantID, link.EnvelopeID)
}
