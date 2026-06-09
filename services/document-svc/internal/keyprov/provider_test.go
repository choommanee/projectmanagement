package keyprov

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Real Postgres on :5432 (project rule — no DB mocks). document_sign_key /
// document_cert_key are PLATFORM tables shared with the dev stack, so every
// test snapshots the active rows and restores them in cleanup.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

// snapshotSignKeys records active sign-key kids and restores them after the
// test, deleting any keys the test created.
func snapshotSignKeys(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	rows, err := p.Query(ctx, `SELECT kid FROM document_sign_key`)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	before := map[string]bool{}
	for rows.Next() {
		var kid string
		_ = rows.Scan(&kid)
		before[kid] = true
	}
	rows.Close()
	var activeBefore []string
	arows, err := p.Query(ctx, `SELECT kid FROM document_sign_key WHERE active`)
	if err != nil {
		t.Fatalf("snapshot active: %v", err)
	}
	for arows.Next() {
		var kid string
		_ = arows.Scan(&kid)
		activeBefore = append(activeBefore, kid)
	}
	arows.Close()
	t.Cleanup(func() {
		rows, err := p.Query(ctx, `SELECT kid FROM document_sign_key`)
		if err != nil {
			return
		}
		var created []string
		for rows.Next() {
			var kid string
			_ = rows.Scan(&kid)
			if !before[kid] {
				created = append(created, kid)
			}
		}
		rows.Close()
		for _, kid := range created {
			_, _ = p.Exec(ctx, `DELETE FROM document_sign_key WHERE kid=$1`, kid)
		}
		for _, kid := range activeBefore {
			_, _ = p.Exec(ctx, `UPDATE document_sign_key SET active=true WHERE kid=$1`, kid)
		}
	})
}

func newMaster(t *testing.T) *[32]byte {
	t.Helper()
	var m [32]byte
	if _, err := rand.Read(m[:]); err != nil {
		t.Fatal(err)
	}
	return &m
}

func TestSealOpenRoundTrip(t *testing.T) {
	master := newMaster(t)
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	ct, nonce, err := sealKey(master, "kid-a", priv)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if string(ct) == string(priv) {
		t.Fatal("ciphertext equals plaintext")
	}
	pt, err := openKey(master, "kid-a", ct, nonce)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !ed25519.PrivateKey(pt).Equal(priv) {
		t.Fatal("round trip mismatch")
	}
	// wrong kid (DEK domain separation) must fail
	if _, err := openKey(master, "kid-b", ct, nonce); err == nil {
		t.Fatal("open with wrong kid should fail")
	}
	// wrong master must fail
	if _, err := openKey(newMaster(t), "kid-a", ct, nonce); err == nil {
		t.Fatal("open with wrong master should fail")
	}
}

func TestDBProviderSignVerify(t *testing.T) {
	p := testPool(t)
	snapshotSignKeys(t, p)
	ctx := context.Background()

	prov := NewDB(p)
	sig, kid, err := prov.Sign(ctx, []byte("hello-chain"))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	signer, kid2, err := prov.Active(ctx)
	if err != nil || kid2 != kid {
		t.Fatalf("active: %v kid=%q want %q", err, kid2, kid)
	}
	if !ed25519.Verify(signer.Public(), []byte("hello-chain"), sig) {
		t.Fatal("signature does not verify")
	}
}

func TestDBEncryptedProviderCreatesEncryptedKeyAndMixedMode(t *testing.T) {
	p := testPool(t)
	snapshotSignKeys(t, p)
	ctx := context.Background()

	// Ensure a plaintext active key exists first (legacy state).
	dbProv := NewDB(p)
	_, plainKid, err := dbProv.Sign(ctx, []byte("legacy"))
	if err != nil {
		t.Fatalf("plaintext bootstrap: %v", err)
	}

	master := newMaster(t)
	enc := NewDBEncrypted(p, master)
	sig, encKid, err := enc.Sign(ctx, []byte("encrypted-era"))
	if err != nil {
		t.Fatalf("encrypted sign: %v", err)
	}
	if encKid == plainKid {
		t.Fatal("encrypted provider must supersede the plaintext key with a NEW kid")
	}
	signer, _, _ := enc.Active(ctx)
	if !ed25519.Verify(signer.Public(), []byte("encrypted-era"), sig) {
		t.Fatal("encrypted-key signature does not verify")
	}

	// At-rest check: the new row must NOT be the raw private key.
	var privB64, alg string
	var nonce []byte
	if err := p.QueryRow(ctx,
		`SELECT private_key, enc_alg, enc_nonce FROM document_sign_key WHERE kid=$1`, encKid).
		Scan(&privB64, &alg, &nonce); err != nil {
		t.Fatalf("read row: %v", err)
	}
	if alg != AlgAES256GCM || len(nonce) == 0 {
		t.Fatalf("want enc_alg=%s + nonce, got alg=%q nonce=%d bytes", AlgAES256GCM, alg, len(nonce))
	}
	raw, _ := base64.StdEncoding.DecodeString(privB64)
	if len(raw) == ed25519.PrivateKeySize {
		t.Fatal("stored private key length equals a raw ed25519 key — looks plaintext")
	}

	// Old plaintext key row must survive (verification of old signatures).
	var plainActive bool
	if err := p.QueryRow(ctx,
		`SELECT active FROM document_sign_key WHERE kid=$1`, plainKid).Scan(&plainActive); err != nil {
		t.Fatalf("plaintext key row vanished: %v", err)
	}
	if plainActive {
		t.Fatal("plaintext key should be superseded (active=false)")
	}

	// A fresh provider instance with the same master decrypts + signs.
	enc2 := NewDBEncrypted(p, master)
	if _, kid2, err := enc2.Sign(ctx, []byte("again")); err != nil || kid2 != encKid {
		t.Fatalf("reload: err=%v kid=%q want %q", err, kid2, encKid)
	}

	// Wrong master key must fail loudly, not sign with garbage.
	encBad := NewDBEncrypted(p, newMaster(t))
	if _, _, err := encBad.Sign(ctx, []byte("nope")); err == nil {
		t.Fatal("wrong master key must fail")
	}

	// Plain db provider must refuse the encrypted active key.
	dbProv2 := NewDB(p)
	if _, _, err := dbProv2.Sign(ctx, []byte("nope")); err == nil {
		t.Fatal("db provider must not silently use an encrypted key")
	}
}

func TestCertKeyLifecycle(t *testing.T) {
	p := testPool(t)
	ctx := context.Background()

	// Snapshot/restore document_cert_key (platform table).
	var hadActive bool
	var prevKid string
	err := p.QueryRow(ctx, `SELECT kid FROM document_cert_key WHERE active ORDER BY created_at ASC LIMIT 1`).Scan(&prevKid)
	hadActive = err == nil
	t.Cleanup(func() {
		if !hadActive {
			// remove anything the test created so dev bootstraps fresh
			_, _ = p.Exec(ctx, `DELETE FROM document_cert_key WHERE kid LIKE 'doc-cert-ecdsa-%' AND created_at > now() - interval '5 minutes'`)
		}
	})

	master := newMaster(t)
	ck, err := LoadOrCreateCertKey(ctx, p, master)
	if err != nil {
		if hadActive {
			// pre-existing cert key sealed under a different deploy master —
			// not this test's state to mutate.
			t.Skipf("active cert key not loadable with ephemeral master: %v", err)
		}
		t.Fatalf("LoadOrCreateCertKey: %v", err)
	}
	if ck.Cert.Subject.CommonName != "PM Platform Document Signing" && !hadActive {
		t.Fatalf("unexpected CN %q", ck.Cert.Subject.CommonName)
	}
	// Reload returns the same identity.
	ck2, err := LoadOrCreateCertKey(ctx, p, master)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if ck2.KID != ck.KID {
		t.Fatalf("kid changed across loads: %q vs %q", ck2.KID, ck.KID)
	}
}
