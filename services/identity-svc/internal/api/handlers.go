package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	sjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
)

func NewRouter(auth *service.Auth, kp *sjwt.KeyPair) http.Handler {
	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	r.Get("/.well-known/jwks.json", jwksHandler(kp))
	r.Post("/v1/login", login(auth))
	return r
}

type loginReq struct {
	TenantID string `json:"tenant_id"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func login(auth *service.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in loginReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, 400, err)
			return
		}
		tid, err := uuid.Parse(in.TenantID)
		if err != nil {
			writeErr(w, 400, errors.New("bad tenant_id"))
			return
		}
		tp, err := auth.Login(r.Context(), service.LoginInput{TenantID: tid, Email: in.Email, Password: in.Password})
		if err != nil {
			if errors.Is(err, domain.ErrInvalidCreds) {
				writeErr(w, 401, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, tp)
	}
}

func jwksHandler(kp *sjwt.KeyPair) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		set, err := kp.JWKS()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		b, _ := json.Marshal(set)
		_, _ = w.Write(b)
	}
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
