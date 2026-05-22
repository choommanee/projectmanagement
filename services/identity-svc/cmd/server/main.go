package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"
	natsx "github.com/pmplatform/libs/go/nats"
	libpolicy "github.com/pmplatform/libs/policy"

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
	rotationInterval := parseDurEnv("JWT_ROTATION_INTERVAL", 0)

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

	// Cedar policy bundle: required at boot so authz decisions are explicit
	// rather than implicitly deny-all on a misconfiguration. The shared
	// bundle lives in libs/policy; POLICY_BUNDLE_PATH overrides the embed,
	// and POLICY_SOURCE=db delegates to the policy_bundle table.
	ps, err := libpolicy.LoadShared()
	if err != nil {
		log.Fatal().Err(err).Msg("load policy bundle")
	}
	// DynamicAdapter holds the live Adapter behind an atomic pointer so
	// /v1/admin/policy/reload can swap it without restarting the service
	// (mirrors the DynamicSigner JWT-rotation pattern).
	authz := libpolicy.NewDynamicAdapter(&libpolicy.Adapter{Policies: ps})

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

	users := store.NewUsers(p)
	tokens := store.NewRefreshTokens(p)
	refreshTTL := parseDurEnv("REFRESH_TOKEN_TTL", 720*time.Hour)
	auth := service.NewAuth(users, store.NewSessions(p), signer, pub).
		WithRefreshTokens(tokens, refreshTTL)
	refresh := service.NewRefresh(users, tokens, signer, pub)
	var _ libauth.Authorizer = authz // compile-time interface check
	h := api.NewRouterWithRefresh(auth, refresh, kp, keyStore, issuer, authz, authz, p)
	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	// Top-level cancellable context for background workers (rotation scheduler).
	rootCtx, cancelRoot := context.WithCancel(context.Background())
	defer cancelRoot()

	// JWT auto-rotation scheduler: optional. When the interval is 0 we
	// skip starting the goroutine entirely so dev environments don't
	// silently mint keys behind your back.
	if rotationInterval > 0 {
		go runRotationScheduler(rootCtx, keyStore, rotationInterval)
		log.Info().Dur("interval", rotationInterval).Msg("jwt rotation scheduler enabled")
	} else {
		log.Info().Msg("jwt rotation scheduler disabled (JWT_ROTATION_INTERVAL=0)")
	}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("identity-svc listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Send()
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	cancelRoot()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// runRotationScheduler ticks every interval and rotates the active JWT
// signing key. The ticker honors ctx so SIGTERM stops it cleanly.
//
// Auto-rotation uses a deterministic kid pattern "auto-<UTC-timestamp>"
// so operators can grep audit logs / signing_key for which rotations
// happened on a schedule vs. via the admin endpoint.
func runRotationScheduler(ctx context.Context, ks *jwt.Store, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, prev := ks.CurrentKey()
			newKid := fmt.Sprintf("auto-%s", time.Now().UTC().Format("20060102T150405"))
			if _, err := ks.Rotate(ctx, newKid); err != nil {
				log.Error().Err(err).Str("new_kid", newKid).Str("prev_kid", prev).Msg("auto rotation failed")
				continue
			}
			log.Info().Str("new_kid", newKid).Str("prev_kid", prev).Msg("auto rotated jwt signing key")
		}
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// parseDurEnv reads a Go duration string from env (e.g. "24h", "30m").
// "" or "0" -> 0 (scheduler disabled). On parse error we return 0 and log
// a warning rather than refusing to boot.
func parseDurEnv(k string, def time.Duration) time.Duration {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		log.Warn().Err(err).Str("env", k).Str("value", v).Msg("invalid duration; using default")
		return def
	}
	return d
}
