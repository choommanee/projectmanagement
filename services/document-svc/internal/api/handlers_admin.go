package api

// Admin HTTP surface for operator-provided (BYO) document-signing certificates.
//
//   POST /v1/admin/sign-cert  {cert_pem, key_pem, chain_pem?}  → install + swap
//   GET  /v1/admin/sign-cert                                   → active metadata
//
// Both are gated by the Cedar action document.sign.cert.import (platform-admin
// only — see libs/policy/bundle.cedar). The POST validates the material and
// atomically swaps the active signing identity at runtime (no restart).

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/pmplatform/services/document-svc/internal/keyprov"
	"github.com/pmplatform/services/document-svc/internal/service"
)

type importSignCertReq struct {
	CertPEM  string `json:"cert_pem"`
	KeyPEM   string `json:"key_pem"`
	ChainPEM string `json:"chain_pem,omitempty"`
}

func importSignCert(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req importSignCertReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, errors.New("invalid JSON body"))
			return
		}
		if req.CertPEM == "" || req.KeyPEM == "" {
			writeErr(w, 400, errors.New("cert_pem and key_pem are required"))
			return
		}
		var chain []byte
		if req.ChainPEM != "" {
			chain = []byte(req.ChainPEM)
		}
		info, err := svc.ImportSignCert(r.Context(), []byte(req.CertPEM), []byte(req.KeyPEM), chain)
		if err != nil {
			var ie *keyprov.ImportError
			if errors.As(err, &ie) {
				writeErr(w, 400, err) // invalid caller-supplied material
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, info)
	}
}

func getActiveSignCert(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		info, ok := svc.ActiveCertInfo()
		if !ok {
			writeErr(w, 404, errors.New("no active signing certificate configured"))
			return
		}
		writeJSON(w, 200, info)
	}
}
