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
	natsx "github.com/pmplatform/libs/go/nats"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/notification-svc/internal/api"
	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
	"github.com/pmplatform/services/notification-svc/internal/worker"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	natsURL := envOr("NATS_URL", "nats://localhost:4222")
	port := envOr("PORT", "8093")

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Msg("pgxpool")
	}
	defer p.Close()

	// Cedar policy bundle: required at boot so authz decisions are explicit
	// rather than implicitly deny-all on a misconfiguration.
	ps, err := libpolicy.LoadShared()
	if err != nil {
		log.Fatal().Err(err).Msg("load policy bundle")
	}
	authz := libpolicy.NewDynamicAdapter(&libpolicy.Adapter{Policies: ps})
	var _ libauth.Authorizer = authz // compile-time interface check

	st := store.New(p)
	prefStore := store.NewPreference(p)
	inapp := service.NewInAppChannel(st)
	channels := []service.Channel{inapp}
	if emailCh, err := service.NewEmailChannelFromEnv(); err != nil {
		log.Warn().Err(err).Msg("email channel disabled")
	} else if emailCh != nil {
		channels = append(channels, emailCh)
	}
	router := service.NewRouter(prefStore, channels...)
	svc := service.New(st)
	h := api.NewRouter(svc, authz)

	// Soft-attach JWT verifier: parses the incoming Authorization: Bearer
	// against identity-svc's JWKS so RequireAction downstream can find
	// claims in context. Failure to reach JWKS at boot is non-fatal — the
	// service still listens but routes guarded by RequireAction return
	// 401 "missing claims" until a successful fetch on next restart.
	jwksURL := envOr("IDENTITY_JWKS_URL", "http://localhost:8082/.well-known/jwks.json")
	issuer := envOr("JWT_ISSUER", "http://localhost:8082")
	if set, err := libauth.FetchJWKS(context.Background(), jwksURL); err != nil {
		log.Warn().Err(err).Str("jwks_url", jwksURL).Msg("JWKS fetch failed — JWT verification disabled until restart")
	} else {
		verifier := libauth.NewVerifier(set, issuer)
		h = libauth.AttachClaims(verifier)(h)
	}

	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// HTTP goroutine.
	go func() {
		log.Info().Str("addr", srv.Addr).Msg("notification-svc listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Send()
		}
	}()

	// Worker goroutine (best-effort: if NATS is unavailable, HTTP keeps serving).
	go func() {
		nc, err := natsx.Connect(natsURL)
		if err != nil {
			log.Warn().Err(err).Str("url", natsURL).Msg("NATS connect failed; worker disabled")
			return
		}
		defer nc.Close()
		if err := worker.Run(rootCtx, nc, router); err != nil && rootCtx.Err() == nil {
			log.Error().Err(err).Msg("worker exited")
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Info().Msg("shutting down")
	cancel()
	ctx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(ctx)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
