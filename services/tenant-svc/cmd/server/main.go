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

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/tenant-svc/internal/api"
	"github.com/pmplatform/services/tenant-svc/internal/service"
	"github.com/pmplatform/services/tenant-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5433/platform?sslmode=disable")
	port := envOr("PORT", "8081")

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	// Cedar policy bundle: required at boot so authz decisions are explicit
	// rather than implicitly deny-all on a misconfiguration. The shared
	// bundle lives in libs/policy; POLICY_BUNDLE_PATH overrides the embed.
	ps, err := libpolicy.LoadShared()
	if err != nil {
		log.Fatal().Err(err).Msg("load policy bundle")
	}
	authz := &libpolicy.Adapter{Policies: ps}
	var _ libauth.Authorizer = authz // compile-time interface check

	// Plan #6 Task 6 — pass the Cedar resource loader so the scoped authz
	// middleware can attach per-instance attrs (tenant_id, owner_user) to
	// each request envelope.
	loader := api.NewCedarLoader(p)
	svc := service.New(store.New(p)).WithCustomFields(store.NewCustomFieldStore(p))
	// Audit trail: direct Postgres writer (no NATS dependency). Every
	// significant mutation is recorded in audit_log via the api emit helper.
	svc.WithAudit(audit.NewPgPublisher(p, "tenant-svc"))
	h := api.NewRouterWithLoader(svc, authz, loader)

	// Soft-attach JWT verifier: parses the incoming Authorization: Bearer
	// against identity-svc's JWKS so RequireAction downstream can find claims
	// in context. Failure to reach JWKS at boot is non-fatal — the service
	// still listens but routes guarded by RequireAction return 401 "missing
	// claims" until a successful fetch on next restart.
	jwksURL := envOr("IDENTITY_JWKS_URL", "http://localhost:8082/.well-known/jwks.json")
	issuer := envOr("JWT_ISSUER", "http://localhost:8082")
	if set, err := libauth.FetchJWKS(context.Background(), jwksURL); err != nil {
		log.Warn().Err(err).Str("jwks_url", jwksURL).Msg("JWKS fetch failed — JWT verification disabled until restart")
	} else {
		verifier := libauth.NewVerifier(set, issuer)
		h = libauth.AttachClaims(verifier)(h)
	}

	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("tenant-svc listening")
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
