package httpx

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func NewBaseRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Use(RequestID)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	return r
}
