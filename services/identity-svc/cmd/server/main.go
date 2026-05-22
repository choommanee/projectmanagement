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
	natsx "github.com/pmplatform/libs/go/nats"

	"github.com/pmplatform/services/identity-svc/internal/api"
	"github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5433/platform?sslmode=disable")
	port := envOr("PORT", "8082")
	issuer := envOr("JWT_ISSUER", "http://localhost:8082")
	kid := envOr("JWT_KID", "kid-dev-1")
	natsURL := envOr("NATS_URL", "nats://localhost:4222")

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	kp, err := jwt.LoadOrCreate(context.Background(), p, kid)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	keyStore := jwt.NewStore(p, 0) // 0 -> default 24h JWKS grace window
	// Seed the in-memory active key so the dynamic signer is ready before
	// the first request, then prefer the DB-backed view if a more recent
	// active key exists (e.g. another replica rotated while we were down).
	keyStore.Bind(kp, kid)
	if err := keyStore.Refresh(context.Background()); err != nil {
		log.Warn().Err(err).Msg("keyStore refresh failed; using bootstrap key")
	}
	// DynamicSigner re-resolves the active key on each Sign call so a
	// rotation via POST /v1/admin/keys/rotate takes effect immediately.
	signer := jwt.NewDynamicSigner(keyStore, issuer)

	// PG publisher always works — direct Postgres write, no NATS dependency.
	pgPub := audit.NewPgPublisher(p, "identity-svc")

	// NATS publisher is optional; used as primary when available.
	var natsFn audit.PublishFn
	if nc, err := natsx.Connect(natsURL); err != nil {
		log.Warn().Err(err).Msg("nats unavailable — audit will fall back to postgres")
	} else {
		defer nc.Close()
		if err := nc.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"}); err != nil {
			log.Warn().Err(err).Msg("nats stream init failed — audit will fall back to postgres")
		} else {
			natsFn = audit.NewPublisher(nc, "identity-svc").Publish
		}
	}

	// Composite: try NATS first, PG as fallback.
	pub := audit.NewFallback(natsFn, pgPub.Publish)

	auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer, pub)
	h := api.NewRouter(auth, kp, keyStore, issuer)
	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("identity-svc listening")
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
