package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

// Signatures is the Tier-1 e-signature store: envelopes, signer rows, audit
// events, and certificates. All tenant-scoped access is RLS-scoped; the
// platform Ed25519 record-signing key (document_sign_key, signkey.go) is the
// one deliberate exception — it is not tenant data.
type Signatures struct {
	p *pgxpool.Pool

	keyMu    sync.Mutex // guards lazy load/create of key
	key      *signKey   // cached active record-signing key
	pubCache sync.Map   // kid -> ed25519.PublicKey (verify path)

	// Trust layer (store/trust.go): optional key-custody provider (nil =
	// legacy plaintext signkey.go path) and RFC 3161 timestamp client.
	keyProv RecordSignProvider
	tsaCli  TimestampClient
}

func NewSignatures(p *pgxpool.Pool) *Signatures { return &Signatures{p: p} }

func (s *Signatures) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// --- column lists -----------------------------------------------------------

const envCols = `id, tenant_id, document_id, version_id, title, status, signing_order,
	created_by, created_at, sent_at, completed_at, voided_at, void_reason, expires_at`

const signerCols = `id, tenant_id, envelope_id, document_id, signer_id, signer_name, signer_email,
	order_index, status, routing_status, auth_method, typed_name,
	(signature_image IS NOT NULL) AS has_image, consent,
	requested_at, viewed_at, signed_at, declined_at, decline_reason,
	content_hash, prev_hash, chained_hash, record_sig, record_kid, version_id`

func scanEnvelope(row pgx.Row) (*domain.SignEnvelope, error) {
	var e domain.SignEnvelope
	err := row.Scan(&e.ID, &e.TenantID, &e.DocumentID, &e.VersionID, &e.Title, &e.Status, &e.SigningOrder,
		&e.CreatedBy, &e.CreatedAt, &e.SentAt, &e.CompletedAt, &e.VoidedAt, &e.VoidReason, &e.ExpiresAt)
	return &e, err
}

func scanSigner(row pgx.Row) (*domain.Signer, error) {
	var s domain.Signer
	err := row.Scan(&s.ID, &s.TenantID, &s.EnvelopeID, &s.DocumentID, &s.SignerID, &s.SignerName, &s.SignerEmail,
		&s.OrderIndex, &s.Status, &s.RoutingStatus, &s.AuthMethod, &s.TypedName,
		&s.HasImage, &s.Consent, &s.RequestedAt, &s.ViewedAt, &s.SignedAt, &s.DeclinedAt, &s.DeclineReason,
		&s.ContentHash, &s.PrevHash, &s.ChainedHash, &s.RecordSig, &s.RecordKid, &s.VersionID)
	return &s, err
}

// --- Envelope creation ------------------------------------------------------

// NewSignerInput describes one signer to add to an envelope.
type NewSignerInput struct {
	SignerID   uuid.UUID
	Name       string
	Email      string
	AuthMethod domain.AuthMethod
}

// CreateEnvelopeInput holds params for a new draft envelope.
type CreateEnvelopeInput struct {
	TenantID     uuid.UUID
	DocumentID   uuid.UUID
	VersionID    *uuid.UUID
	Title        string
	SigningOrder domain.SigningOrder
	CreatedBy    *uuid.UUID
	ExpiresAt    *time.Time
	Signers      []NewSignerInput
}

// CreateEnvelope inserts a draft envelope plus its signer rows atomically.
// The first signer (order 0) is routed 'active' for sequential order;
// parallel envelopes mark all signers 'active' only on send.
func (s *Signatures) CreateEnvelope(ctx context.Context, in CreateEnvelopeInput) (*domain.SignEnvelope, error) {
	var env *domain.SignEnvelope
	err := s.withTenant(ctx, in.TenantID, func(tx pgx.Tx) error {
		var err error
		env, err = scanEnvelope(tx.QueryRow(ctx,
			`INSERT INTO document_sign_envelope
				(tenant_id, document_id, version_id, title, signing_order, created_by, expires_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)
			 RETURNING `+envCols,
			in.TenantID, in.DocumentID, in.VersionID, in.Title, string(in.SigningOrder), in.CreatedBy, in.ExpiresAt))
		if err != nil {
			return err
		}
		for i, sg := range in.Signers {
			am := sg.AuthMethod
			if am == "" {
				am = domain.AuthSession
			}
			signer, err := scanSigner(tx.QueryRow(ctx,
				`INSERT INTO document_signature
					(tenant_id, envelope_id, document_id, signer_id, signer_name, signer_email, order_index, auth_method, version_id)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
				 RETURNING `+signerCols,
				in.TenantID, env.ID, in.DocumentID, sg.SignerID, sg.Name, sg.Email, i, string(am), in.VersionID))
			if err != nil {
				return err
			}
			env.Signers = append(env.Signers, *signer)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return env, nil
}

// GetEnvelope returns an envelope with its signers ordered by order_index.
func (s *Signatures) GetEnvelope(ctx context.Context, tid, envID uuid.UUID) (*domain.SignEnvelope, error) {
	var env *domain.SignEnvelope
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var e error
		env, e = scanEnvelope(tx.QueryRow(ctx, `SELECT `+envCols+` FROM document_sign_envelope WHERE id=$1`, envID))
		if e != nil {
			return e
		}
		rows, e := tx.Query(ctx, `SELECT `+signerCols+` FROM document_signature WHERE envelope_id=$1 ORDER BY order_index ASC`, envID)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var sg domain.Signer
			if e := rows.Scan(&sg.ID, &sg.TenantID, &sg.EnvelopeID, &sg.DocumentID, &sg.SignerID, &sg.SignerName, &sg.SignerEmail,
				&sg.OrderIndex, &sg.Status, &sg.RoutingStatus, &sg.AuthMethod, &sg.TypedName,
				&sg.HasImage, &sg.Consent, &sg.RequestedAt, &sg.ViewedAt, &sg.SignedAt, &sg.DeclinedAt, &sg.DeclineReason,
				&sg.ContentHash, &sg.PrevHash, &sg.ChainedHash, &sg.RecordSig, &sg.RecordKid, &sg.VersionID); e != nil {
				return e
			}
			env.Signers = append(env.Signers, sg)
		}
		return rows.Err()
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return env, nil
}

// ListEnvelopesForDocument returns envelopes (without signers) for a document.
func (s *Signatures) ListEnvelopesForDocument(ctx context.Context, tid, docID uuid.UUID) ([]domain.SignEnvelope, error) {
	var out []domain.SignEnvelope
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+envCols+` FROM document_sign_envelope WHERE document_id=$1 ORDER BY created_at DESC`, docID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e domain.SignEnvelope
			if err := rows.Scan(&e.ID, &e.TenantID, &e.DocumentID, &e.VersionID, &e.Title, &e.Status, &e.SigningOrder,
				&e.CreatedBy, &e.CreatedAt, &e.SentAt, &e.CompletedAt, &e.VoidedAt, &e.VoidReason, &e.ExpiresAt); err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	return out, err
}

// Send moves a draft envelope to 'sent' and activates routing.
func (s *Signatures) Send(ctx context.Context, tid, envID uuid.UUID) (*domain.SignEnvelope, error) {
	now := time.Now().UTC()
	var env *domain.SignEnvelope
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var order string
		var status string
		if err := tx.QueryRow(ctx, `SELECT signing_order, status FROM document_sign_envelope WHERE id=$1`, envID).Scan(&order, &status); err != nil {
			return err
		}
		if status != string(domain.EnvDraft) {
			return domain.ErrInvalidInput
		}
		if _, err := tx.Exec(ctx,
			`UPDATE document_sign_envelope SET status='sent', sent_at=$2 WHERE id=$1`, envID, now); err != nil {
			return err
		}
		if domain.SigningOrder(order) == domain.OrderParallel {
			if _, err := tx.Exec(ctx,
				`UPDATE document_signature SET routing_status='active' WHERE envelope_id=$1 AND status='pending'`, envID); err != nil {
				return err
			}
		} else {
			// sequential: activate only the lowest-order pending signer
			if _, err := tx.Exec(ctx,
				`UPDATE document_signature SET routing_status='active'
				 WHERE id = (SELECT id FROM document_signature WHERE envelope_id=$1 AND status='pending' ORDER BY order_index ASC LIMIT 1)`, envID); err != nil {
				return err
			}
		}
		var e error
		env, e = scanEnvelope(tx.QueryRow(ctx, `SELECT `+envCols+` FROM document_sign_envelope WHERE id=$1`, envID))
		return e
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return env, nil
}

// MarkViewed sets viewed_at on a signer if not already set.
func (s *Signatures) MarkViewed(ctx context.Context, tid, envID, signerRowID uuid.UUID) (*domain.Signer, error) {
	var sg *domain.Signer
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var e error
		sg, e = scanSigner(tx.QueryRow(ctx,
			`UPDATE document_signature SET viewed_at=COALESCE(viewed_at, now())
			 WHERE id=$1 AND envelope_id=$2 RETURNING `+signerCols, signerRowID, envID))
		return e
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return sg, nil
}

// SignInput holds the data captured when a signer signs.
type SignInput struct {
	TenantID    uuid.UUID
	EnvelopeID  uuid.UUID
	SignerRowID uuid.UUID
	Consent     bool
	TypedName   string
	ImageBytes  []byte
	AuthMethod  domain.AuthMethod
	// ContentBody is the EXACT document version body snapshot at signing time.
	ContentBody map[string]any
}

// SignResult reports the post-sign state.
type SignResult struct {
	Signer    *domain.Signer
	Envelope  *domain.SignEnvelope
	Completed bool // true if this sign completed the whole envelope
}

// Sign records a signature: captures the content hash + chained hash, marks
// the signer signed, advances routing, and completes the envelope when the
// last signer signs. Runs in a single transaction.
//
// The signed_at timestamp is truncated to MICROSECONDS before hashing because
// Postgres timestamptz stores µs precision: hashing the ns-precision value
// would make verification (which re-reads signed_at from PG) fail on any
// platform whose clock yields sub-µs digits (e.g. Linux).
func (s *Signatures) Sign(ctx context.Context, in SignInput) (*SignResult, error) {
	now := time.Now().UTC().Truncate(time.Microsecond)

	// Resolve the platform record-signing key OUTSIDE the tenant tx (the key
	// is platform-scoped, and lazy generation must not roll back with it).
	// recordSigner (store/trust.go) routes via the keyprov.Provider when one
	// is configured, else the legacy plaintext signkey.go path.
	rsign, err := s.recordSigner(ctx)
	if err != nil {
		return nil, err
	}

	res := &SignResult{}
	err = s.withTenant(ctx, in.TenantID, func(tx pgx.Tx) error {
		// Load the target signer and verify it is active + pending.
		var status, routing string
		var orderIndex int
		var signerUUID uuid.UUID
		if err := tx.QueryRow(ctx,
			`SELECT status, routing_status, order_index, signer_id FROM document_signature WHERE id=$1 AND envelope_id=$2`,
			in.SignerRowID, in.EnvelopeID).Scan(&status, &routing, &orderIndex, &signerUUID); err != nil {
			return err
		}
		if status != string(domain.SigPending) {
			return domain.ErrConflict
		}
		if routing != string(domain.RouteActive) {
			return domain.ErrInvalidInput // not this signer's turn yet
		}

		// Envelope must be in 'sent'.
		var envStatus, signingOrder string
		if err := tx.QueryRow(ctx, `SELECT status, signing_order FROM document_sign_envelope WHERE id=$1`, in.EnvelopeID).
			Scan(&envStatus, &signingOrder); err != nil {
			return err
		}
		if envStatus != string(domain.EnvSent) {
			return domain.ErrInvalidInput
		}

		// Compute hash chain: prev = chained_hash of the last signed signer.
		var prevHash string
		_ = tx.QueryRow(ctx,
			`SELECT COALESCE(chained_hash,'') FROM document_signature
			 WHERE envelope_id=$1 AND status='signed' ORDER BY signed_at DESC LIMIT 1`, in.EnvelopeID).Scan(&prevHash)

		contentHash := domain.CanonicalContentHash(in.ContentBody)
		am := in.AuthMethod
		if am == "" {
			am = domain.AuthSession
		}
		chained := domain.ChainHash(prevHash, contentHash, signerUUID.String(),
			now.Format(time.RFC3339Nano), string(am), in.TypedName)

		// Ed25519 record signature over the chained hash: defends against a
		// DB-write attacker recomputing the whole SHA-256 chain after edits.
		recordSig, recordKid, err := rsign(chained)
		if err != nil {
			return err
		}

		var e error
		res.Signer, e = scanSigner(tx.QueryRow(ctx,
			`UPDATE document_signature SET
				status='signed', routing_status='completed', signed_at=$2,
				consent=$3, typed_name=$4, signature_image=$5, auth_method=$6,
				content_hash=$7, prev_hash=$8, chained_hash=$9,
				record_sig=$10, record_kid=$11
			 WHERE id=$1 RETURNING `+signerCols,
			in.SignerRowID, now, in.Consent, in.TypedName, in.ImageBytes, string(am),
			contentHash, prevHash, chained, recordSig, recordKid))
		if e != nil {
			return e
		}

		// Advance routing for sequential envelopes: activate the next pending.
		if domain.SigningOrder(signingOrder) == domain.OrderSequential {
			if _, err := tx.Exec(ctx,
				`UPDATE document_signature SET routing_status='active'
				 WHERE id = (SELECT id FROM document_signature WHERE envelope_id=$1 AND status='pending' AND routing_status='waiting' ORDER BY order_index ASC LIMIT 1)`,
				in.EnvelopeID); err != nil {
				return err
			}
		}

		// Completion check: no pending signers remain.
		var pending int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM document_signature WHERE envelope_id=$1 AND status='pending'`, in.EnvelopeID).Scan(&pending); err != nil {
			return err
		}
		if pending == 0 {
			if _, err := tx.Exec(ctx,
				`UPDATE document_sign_envelope SET status='completed', completed_at=$2 WHERE id=$1`, in.EnvelopeID, now); err != nil {
				return err
			}
			// Reflect completion on the parent document: a fully-signed
			// document is 'approved' (the domain's signed/completed state).
			// version bumps so concurrent editors get a clean 409 instead of
			// silently clobbering the status.
			if _, err := tx.Exec(ctx,
				`UPDATE document SET status='approved', version=version+1, updated_at=now()
				 WHERE id=(SELECT document_id FROM document_sign_envelope WHERE id=$1)
				   AND status <> 'approved'`, in.EnvelopeID); err != nil {
				return err
			}
			res.Completed = true
		}

		res.Envelope, e = scanEnvelope(tx.QueryRow(ctx, `SELECT `+envCols+` FROM document_sign_envelope WHERE id=$1`, in.EnvelopeID))
		return e
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// Best-effort RFC 3161 anchor of the chained hash (store/trust.go) —
	// runs after commit so a slow TSA never blocks or rolls back signing.
	s.attachTimestamp(ctx, in.TenantID, res)
	return res, nil
}

// Decline marks a signer declined and the envelope declined.
func (s *Signatures) Decline(ctx context.Context, tid, envID, signerRowID uuid.UUID, reason string) (*domain.Signer, *domain.SignEnvelope, error) {
	now := time.Now().UTC()
	var sg *domain.Signer
	var env *domain.SignEnvelope
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM document_signature WHERE id=$1 AND envelope_id=$2`, signerRowID, envID).Scan(&status); err != nil {
			return err
		}
		if status != string(domain.SigPending) {
			return domain.ErrConflict
		}
		var e error
		sg, e = scanSigner(tx.QueryRow(ctx,
			`UPDATE document_signature SET status='declined', routing_status='declined', declined_at=$2, decline_reason=$3
			 WHERE id=$1 RETURNING `+signerCols, signerRowID, now, reason))
		if e != nil {
			return e
		}
		if _, err := tx.Exec(ctx,
			`UPDATE document_sign_envelope SET status='declined' WHERE id=$1 AND status IN ('draft','sent')`, envID); err != nil {
			return err
		}
		env, e = scanEnvelope(tx.QueryRow(ctx, `SELECT `+envCols+` FROM document_sign_envelope WHERE id=$1`, envID))
		return e
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	return sg, env, nil
}

// Void marks an envelope voided (only from draft/sent).
func (s *Signatures) Void(ctx context.Context, tid, envID uuid.UUID, reason string) (*domain.SignEnvelope, error) {
	now := time.Now().UTC()
	var env *domain.SignEnvelope
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`UPDATE document_sign_envelope SET status='voided', voided_at=$2, void_reason=$3
			 WHERE id=$1 AND status IN ('draft','sent')`, envID, now, reason)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		var e error
		env, e = scanEnvelope(tx.QueryRow(ctx, `SELECT `+envCols+` FROM document_sign_envelope WHERE id=$1`, envID))
		return e
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return env, nil
}

// --- Audit events -----------------------------------------------------------

// RecordEvent inserts an audit-trail event, chained to the previous hashed
// event for the envelope via prev_event_hash/event_hash (tamper-evident
// audit trail; legacy rows predating 00007 carry NULL hashes). created_at is
// µs-truncated in Go and inserted explicitly so the hashed timestamp
// round-trips identically through Postgres.
func (s *Signatures) RecordEvent(ctx context.Context, ev domain.SignEvent) error {
	meta := ev.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	metaJSON, _ := json.Marshal(meta)
	ev.CreatedAt = time.Now().UTC().Truncate(time.Microsecond)
	return s.withTenant(ctx, ev.TenantID, func(tx pgx.Tx) error {
		var prev string
		_ = tx.QueryRow(ctx,
			`SELECT event_hash FROM document_sign_event
			 WHERE envelope_id=$1 AND event_hash IS NOT NULL ORDER BY seq DESC LIMIT 1`,
			ev.EnvelopeID).Scan(&prev)
		hash := domain.EventChainHash(prev, ev)
		_, err := tx.Exec(ctx,
			`INSERT INTO document_sign_event
				(tenant_id, envelope_id, signer_id, event_type, actor_id, ip_address, user_agent, geo, metadata,
				 created_at, prev_event_hash, event_hash)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			ev.TenantID, ev.EnvelopeID, ev.SignerID, string(ev.EventType), ev.ActorID,
			ev.IPAddress, ev.UserAgent, ev.Geo, metaJSON,
			ev.CreatedAt, prev, hash)
		return err
	})
}

// ListEvents returns the audit trail for an envelope, oldest first (seq order
// is insert order, deterministic even when timestamps collide at µs grain).
func (s *Signatures) ListEvents(ctx context.Context, tid, envID uuid.UUID) ([]domain.SignEvent, error) {
	var out []domain.SignEvent
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, envelope_id, signer_id, event_type, actor_id, ip_address, user_agent, geo, metadata, created_at,
			        prev_event_hash, event_hash
			 FROM document_sign_event WHERE envelope_id=$1 ORDER BY seq ASC`, envID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ev domain.SignEvent
			var metaBytes []byte
			if err := rows.Scan(&ev.ID, &ev.TenantID, &ev.EnvelopeID, &ev.SignerID, &ev.EventType, &ev.ActorID,
				&ev.IPAddress, &ev.UserAgent, &ev.Geo, &metaBytes, &ev.CreatedAt,
				&ev.PrevEventHash, &ev.EventHash); err != nil {
				return err
			}
			ev.Metadata = fromJSON(metaBytes)
			out = append(out, ev)
		}
		return rows.Err()
	})
	return out, err
}

// --- Certificate persistence ------------------------------------------------

// SaveCertificate stores generated PDF bytes for an envelope (idempotent upsert).
func (s *Signatures) SaveCertificate(ctx context.Context, tid, envID, docID uuid.UUID, finalHash string, pdf []byte) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO document_sign_certificate (tenant_id, envelope_id, document_id, final_hash, pdf_bytes)
			 VALUES ($1,$2,$3,$4,$5)
			 ON CONFLICT (tenant_id, envelope_id)
			 DO UPDATE SET final_hash=EXCLUDED.final_hash, pdf_bytes=EXCLUDED.pdf_bytes, created_at=now()`,
			tid, envID, docID, finalHash, pdf)
		return err
	})
}

// GetCertificate returns stored certificate PDF bytes for an envelope.
func (s *Signatures) GetCertificate(ctx context.Context, tid, envID uuid.UUID) ([]byte, error) {
	var pdf []byte
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT pdf_bytes FROM document_sign_certificate WHERE envelope_id=$1`, envID).Scan(&pdf)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return pdf, nil
}
