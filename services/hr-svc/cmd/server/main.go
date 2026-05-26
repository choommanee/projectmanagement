package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/go-chi/chi/v5"
	libauth "github.com/pmplatform/libs/go/auth"
	libotel "github.com/pmplatform/libs/go/otel"
	libpolicy "github.com/pmplatform/libs/policy"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/pmplatform/services/hr-svc/internal/api"
	"github.com/pmplatform/services/hr-svc/internal/service"
	"github.com/pmplatform/services/hr-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8096")

	// OTEL tracing: non-fatal; service still starts if collector is unreachable.
	if otelShutdown, err := libotel.SetupOTLP(context.Background(), "hr-svc"); err != nil {
		log.Warn().Err(err).Msg("OTEL setup failed — continuing without tracing")
	} else {
		defer otelShutdown()
	}

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	depts := store.NewDepartmentStore(p)
	positions := store.NewPositionStore(p)
	employees := store.NewEmployeeStore(p)
	payslips := store.NewPayslipStore(p)

	svc := service.New(depts, positions, employees, payslips)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		log.Fatal().Err(err).Msg("load cedar policy bundle")
	}
	authz := &libpolicy.Adapter{Policies: ps}

	h := api.NewRouter(svc, authz)

	// Soft-attach JWT verifier against identity-svc JWKS so RequireAction
	// finds claims in context. Boot-time fetch failure is non-fatal.
	jwksURL := envOr("IDENTITY_JWKS_URL", "http://localhost:8082/.well-known/jwks.json")
	issuer := envOr("JWT_ISSUER", "http://localhost:8082")
	var verifier *libauth.Verifier
	if set, err := libauth.FetchJWKS(context.Background(), jwksURL); err != nil {
		log.Warn().Err(err).Str("jwks_url", jwksURL).Msg("JWKS fetch failed — JWT verification disabled until restart")
	} else {
		verifier = libauth.NewVerifier(set, issuer)
	}
	if verifier != nil {
		h = libauth.AttachClaims(verifier)(h)
	}

	mux := chi.NewRouter()
	mux.Get("/metrics", libotel.PrometheusHandler().ServeHTTP)
	mux.Mount("/", h)
	tracedHandler := otelhttp.NewHandler(mux, "hr-svc")
	srv := &http.Server{Addr: ":" + port, Handler: tracedHandler, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("hr-svc listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Send()
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
