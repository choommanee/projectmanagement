package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// fakeTSA returns a canned token (success) or an error (outage).
type fakeTSA struct {
	token []byte
	err   error
	calls int
}

func (f *fakeTSA) Timestamp(_ context.Context, _ []byte) ([]byte, time.Time, error) {
	f.calls++
	if f.err != nil {
		return nil, time.Time{}, f.err
	}
	return f.token, time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC), nil
}

func signFirstSigner(t *testing.T, sig *store.Signatures, tid uuid.UUID, env *domain.SignEnvelope) *store.SignResult {
	t.Helper()
	ctx := context.Background()
	if _, err := sig.Send(ctx, tid, env.ID); err != nil {
		t.Fatalf("send: %v", err)
	}
	full, _ := sig.GetEnvelope(ctx, tid, env.ID)
	var rowID uuid.UUID
	for _, s := range full.Signers {
		if s.RoutingStatus == domain.RouteActive {
			rowID = s.ID
			break
		}
	}
	res, err := sig.Sign(ctx, store.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: rowID,
		Consent: true, TypedName: "Alice",
		ContentBody: map[string]any{"type": "doc"},
	})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return res
}

func makeEnvelope(t *testing.T, sig *store.Signatures, tid, docID uuid.UUID, versionID *uuid.UUID) *domain.SignEnvelope {
	t.Helper()
	env, err := sig.CreateEnvelope(context.Background(), store.CreateEnvelopeInput{
		TenantID: tid, DocumentID: docID, VersionID: versionID,
		Title: "TSA", SigningOrder: domain.OrderSequential,
		Signers: []store.NewSignerInput{{SignerID: uuid.New(), Name: "Alice", Email: "a@x.com"}},
	})
	if err != nil {
		t.Fatalf("create envelope: %v", err)
	}
	return env
}

func TestSignAttachesTimestampToken(t *testing.T) {
	tid, docID, docStore, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	doc, _ := docStore.GetByID(ctx, tid, docID)

	ft := &fakeTSA{token: []byte("der-token-bytes")}
	sig.WithTimestamper(ft)

	env := makeEnvelope(t, sig, tid, docID, doc.CurrentVersionID)
	res := signFirstSigner(t, sig, tid, env)
	if ft.calls != 1 {
		t.Fatalf("expected 1 TSA call, got %d", ft.calls)
	}

	recs, err := sig.TSARecords(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("TSARecords: %v", err)
	}
	rec, ok := recs[res.Signer.ID]
	if !ok {
		t.Fatal("no TSA record for signed row")
	}
	if rec.Source != "rfc3161" || string(rec.Token) != "der-token-bytes" || rec.Time == nil {
		t.Fatalf("unexpected record: source=%q token=%q time=%v", rec.Source, rec.Token, rec.Time)
	}
}

func TestSignDegradesToLocalOnTSAOutage(t *testing.T) {
	tid, docID, docStore, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	doc, _ := docStore.GetByID(ctx, tid, docID)

	sig.WithTimestamper(&fakeTSA{err: errors.New("tsa down")})

	env := makeEnvelope(t, sig, tid, docID, doc.CurrentVersionID)
	res := signFirstSigner(t, sig, tid, env) // must NOT fail

	recs, err := sig.TSARecords(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("TSARecords: %v", err)
	}
	rec := recs[res.Signer.ID]
	if rec.Source != "local" || len(rec.Token) != 0 {
		t.Fatalf("outage should leave source=local with no token, got source=%q token=%d bytes", rec.Source, len(rec.Token))
	}
}

func TestSignWithoutTimestamperStaysLocal(t *testing.T) {
	tid, docID, docStore, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	doc, _ := docStore.GetByID(ctx, tid, docID)

	env := makeEnvelope(t, sig, tid, docID, doc.CurrentVersionID)
	res := signFirstSigner(t, sig, tid, env)

	recs, _ := sig.TSARecords(ctx, tid, env.ID)
	if rec := recs[res.Signer.ID]; rec.Source != "local" {
		t.Fatalf("want local, got %q", rec.Source)
	}
}
