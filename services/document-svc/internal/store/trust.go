package store

// Trust layer for the e-signature store: pluggable key custody for the
// Ed25519 record-signing key (internal/keyprov) and best-effort RFC 3161
// trusted timestamping of each signature's chained_hash (internal/tsa).
// All additions live here so store/signature.go keeps only minimal hooks.

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// sign signs data with the legacy in-memory key (see signkey.go).
func (k *signKey) sign(data []byte) []byte { return ed25519.Sign(k.priv, data) }

// RecordSignProvider abstracts custody of the record-signing key
// (implemented by keyprov.Provider). Nil falls back to the legacy plaintext
// document_sign_key path in signkey.go.
type RecordSignProvider interface {
	Sign(ctx context.Context, data []byte) (sig []byte, kid string, err error)
}

// TimestampClient requests RFC 3161 tokens (implemented by *tsa.Client).
type TimestampClient interface {
	Timestamp(ctx context.Context, message []byte) (token []byte, genTime time.Time, err error)
}

// WithKeyProvider routes record signing through a keyprov.Provider.
func (s *Signatures) WithKeyProvider(p RecordSignProvider) *Signatures {
	s.keyProv = p
	return s
}

// WithTimestamper enables RFC 3161 timestamping of signature records.
func (s *Signatures) WithTimestamper(t TimestampClient) *Signatures {
	s.tsaCli = t
	return s
}

// recordSigner resolves the signing function for the Sign path. It is called
// BEFORE the tenant transaction so lazy key bootstrap never rolls back with
// it; the returned closure is pure CPU (Ed25519 sign of the chained hash).
func (s *Signatures) recordSigner(ctx context.Context) (func(chained string) (sigB64, kid string, err error), error) {
	if s.keyProv != nil {
		// Warm the provider's key cache outside the tx; Sign reuses it.
		if _, _, err := s.keyProv.Sign(ctx, []byte("warmup")); err != nil {
			return nil, err
		}
		return func(chained string) (string, string, error) {
			sig, kid, err := s.keyProv.Sign(ctx, []byte(chained))
			if err != nil {
				return "", "", err
			}
			return base64.StdEncoding.EncodeToString(sig), kid, nil
		}, nil
	}
	key, err := s.activeSignKey(ctx)
	if err != nil {
		return nil, err
	}
	return func(chained string) (string, string, error) {
		return base64.StdEncoding.EncodeToString(key.sign([]byte(chained))), key.kid, nil
	}, nil
}

// attachTimestamp requests an RFC 3161 token over the freshly committed
// signature's chained_hash and stores it on the row. Strictly best-effort:
// any failure leaves the row at timestamp_source='local' (the migration
// default) and never surfaces to the signer. Called AFTER the signing
// transaction commits so a slow TSA cannot hold the tx open.
func (s *Signatures) attachTimestamp(ctx context.Context, tid uuid.UUID, res *SignResult) {
	if s.tsaCli == nil || res == nil || res.Signer == nil || res.Signer.ChainedHash == "" {
		return
	}
	tctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	token, genTime, err := s.tsaCli.Timestamp(tctx, []byte(res.Signer.ChainedHash))
	if err != nil {
		return // graceful degradation — row stays timestamp_source='local'
	}
	_ = s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx,
			`UPDATE document_signature SET tsa_token=$2, tsa_time=$3, timestamp_source='rfc3161' WHERE id=$1`,
			res.Signer.ID, token, genTime)
		return e
	})
}

// TSARecord is the stored timestamp evidence for one signature row.
type TSARecord struct {
	Token  []byte
	Time   *time.Time
	Source string
}

// TSARecords returns timestamp evidence keyed by signature row id for an
// envelope (verify + certificate paths).
func (s *Signatures) TSARecords(ctx context.Context, tid, envID uuid.UUID) (map[uuid.UUID]TSARecord, error) {
	out := map[uuid.UUID]TSARecord{}
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tsa_token, tsa_time, timestamp_source FROM document_signature WHERE envelope_id=$1`, envID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			var rec TSARecord
			if err := rows.Scan(&id, &rec.Token, &rec.Time, &rec.Source); err != nil {
				return err
			}
			out[id] = rec
		}
		return rows.Err()
	})
	return out, err
}
