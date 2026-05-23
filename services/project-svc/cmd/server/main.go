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

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/project-svc/internal/api"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5433/platform?sslmode=disable")
	port := envOr("PORT", "8083")

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

	svc := service.New(store.NewProjects(p), store.NewTasks(p), store.NewSprints(p))
	// Plan #6 Task 6 — pass the Cedar resource loader so scoped authz can
	// attach per-instance attrs (tenant_id, owner_user) to each decision.
	loader := api.NewCedarLoader(p)
	h := api.NewRouterWithLoader(svc, authz, loader)

	// Soft-attach JWT verifier: parses the incoming Authorization: Bearer
	// against identity-svc's JWKS so RequireAction downstream can find
	// claims in context. Failure to reach JWKS at boot is non-fatal — the
	// service still listens but routes guarded by RequireAction return
	// 401 "missing claims" until a successful fetch on next restart.
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

	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("project-svc listening")
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
