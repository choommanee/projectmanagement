package api_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/keyprov"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// adminCertRouter wires a document-svc router with the BYO-cert importer.
func adminCertRouter(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(store.NewWorkspaces(p), store.NewDocuments(p), store.NewComments(p), store.NewTemplates(p)).
		WithSignatures(store.NewSignatures(p)).
		WithCertImporter(keyprov.NewCertManager(p, nil))
	return api.NewRouterWithLoader(svc, authz, api.NewCedarLoader(p))
}

func leafCertPEM(t *testing.T, cn string) (certPEM, keyPEM []byte) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(time.Now().UnixNano()),
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage:    []asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 36}},
		BasicConstraintsValid: true,
	}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	pkcs8, _ := x509.MarshalPKCS8PrivateKey(key)
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})
	return
}

// restoreCertKeys snapshots + restores the platform document_cert_key table.
func restoreCertKeys(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	before := map[string]bool{}
	rows, _ := p.Query(ctx, `SELECT kid FROM document_cert_key`)
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		before[k] = true
	}
	rows.Close()
	var active string
	_ = p.QueryRow(ctx, `SELECT kid FROM document_cert_key WHERE active ORDER BY created_at ASC LIMIT 1`).Scan(&active)
	t.Cleanup(func() {
		cur, _ := p.Query(ctx, `SELECT kid FROM document_cert_key`)
		var kids []string
		for cur.Next() {
			var k string
			_ = cur.Scan(&k)
			kids = append(kids, k)
		}
		cur.Close()
		for _, k := range kids {
			if !before[k] {
				_, _ = p.Exec(ctx, `DELETE FROM document_cert_key WHERE kid=$1`, k)
			}
		}
		_, _ = p.Exec(ctx, `UPDATE document_cert_key SET active=false`)
		if active != "" {
			_, _ = p.Exec(ctx, `UPDATE document_cert_key SET active=true WHERE kid=$1`, active)
		}
	})
}

func TestCedarGatesAdminSignCertImport(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	restoreCertKeys(t, p)
	tid := seedCedarTenant(t, p)

	ps, _ := libpolicy.LoadShared()
	authz := &libpolicy.Adapter{Policies: ps}
	router := adminCertRouter(p, authz)

	certPEM, keyPEM := leafCertPEM(t, "Customer Signing Cert")
	body, _ := json.Marshal(map[string]any{"cert_pem": string(certPEM), "key_pem": string(keyPEM)})

	post := func(roles []string, payload []byte) *httptest.ResponseRecorder {
		h := withClaims(router, &libauth.ParsedClaims{Subject: uuid.NewString(), TenantID: tid.String(), Roles: roles, ExpireAt: time.Now().Add(time.Minute)})
		req := httptest.NewRequest(http.MethodPost, "/v1/admin/sign-cert", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Tenant-Id", tid.String())
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	// Denied: project-manager → 403.
	if rec := post([]string{"project-manager"}, body); rec.Code != http.StatusForbidden {
		t.Fatalf("PM import want 403, got %d: %s", rec.Code, rec.Body.String())
	}

	// Allowed: platform-admin → 200 with the imported subject.
	rec := post([]string{"platform-admin"}, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin import want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var info struct {
		KID       string `json:"kid"`
		SubjectCN string `json:"subject_cn"`
		KeyType   string `json:"key_type"`
	}
	json.Unmarshal(rec.Body.Bytes(), &info)
	if info.SubjectCN != "Customer Signing Cert" || info.KID == "" {
		t.Fatalf("unexpected import response: %s", rec.Body.String())
	}

	// Malformed PEM → 400.
	bad, _ := json.Marshal(map[string]any{"cert_pem": "not-a-pem", "key_pem": string(keyPEM)})
	if rec := post([]string{"platform-admin"}, bad); rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed PEM want 400, got %d: %s", rec.Code, rec.Body.String())
	}

	// Mismatched key → 400.
	_, otherKey := leafCertPEM(t, "Other")
	mism, _ := json.Marshal(map[string]any{"cert_pem": string(certPEM), "key_pem": string(otherKey)})
	if rec := post([]string{"platform-admin"}, mism); rec.Code != http.StatusBadRequest {
		t.Fatalf("mismatched key want 400, got %d: %s", rec.Code, rec.Body.String())
	}

	// GET active metadata as platform-admin → 200.
	g := withClaims(router, &libauth.ParsedClaims{Subject: uuid.NewString(), TenantID: tid.String(), Roles: []string{"platform-admin"}, ExpireAt: time.Now().Add(time.Minute)})
	greq := httptest.NewRequest(http.MethodGet, "/v1/admin/sign-cert", nil)
	greq.Header.Set("X-Tenant-Id", tid.String())
	grec := httptest.NewRecorder()
	g.ServeHTTP(grec, greq)
	if grec.Code != http.StatusOK {
		t.Fatalf("GET active cert want 200, got %d: %s", grec.Code, grec.Body.String())
	}
}
