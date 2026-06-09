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

	"github.com/go-chi/chi/v5"
	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"
	natsx "github.com/pmplatform/libs/go/nats"
	notiflib "github.com/pmplatform/libs/go/notification"
	libotel "github.com/pmplatform/libs/go/otel"
	libpolicy "github.com/pmplatform/libs/policy"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/pmplatform/services/identity-svc/internal/api"
	"github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8082")
	issuer := envOr("JWT_ISSUER", "http://localhost:8082")
	kid := envOr("JWT_KID", "kid-dev-1")
	natsURL := envOr("NATS_URL", "nats://localhost:4222")
	rotationInterval := parseDurEnv("JWT_ROTATION_INTERVAL", 0)

	// OTEL tracing: non-fatal; service still starts if collector is unreachable.
	if otelShutdown, err := libotel.SetupOTLP(context.Background(), "identity-svc"); err != nil {
		log.Warn().Err(err).Msg("OTEL setup failed — continuing without tracing")
	} else {
		defer otelShutdown()
	}

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
	// the first request.
	keyStore.Bind(kp, kid)
	// Reconcile to EXACTLY ONE active key: if legacy pollution / a crashed
	// rotation left multiple actives, keep the newest and supersede the rest,
	// then bind the in-memory signer to it so DB + signer + JWKS all agree on
	// a single minting kid. Falls back to the bootstrap bind if nothing is
	// active. This is the boot-consistency guard against the desync that caused
	// the platform-wide 401 (signer minting a kid that JWKS no longer served).
	if reconciledKid, err := keyStore.ReconcileActive(context.Background()); err != nil {
		log.Warn().Err(err).Msg("keyStore reconcile failed; using bootstrap key")
	} else if reconciledKid != "" {
		kid = reconciledKid
		log.Info().Str("active_kid", reconciledKid).Msg("signing key reconciled to single active")
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
	// nc is hoisted so the notification mailer can reuse the same connection.
	var natsFn audit.PublishFn
	var natsClient *natsx.Client
	if nc, err := natsx.Connect(natsURL); err != nil {
		log.Warn().Err(err).Msg("nats unavailable — audit will fall back to postgres")
	} else {
		natsClient = nc
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
	resets := store.NewPasswordResets(p)
	mfaEnrollments := store.NewMFAEnrollments(p)
	refreshTTL := parseDurEnv("REFRESH_TOKEN_TTL", 720*time.Hour)
	resetTTL := parseDurEnv("PASSWORD_RESET_TTL", time.Hour)
	resetLinkURL := envOr("PASSWORD_RESET_LINK_URL", "http://localhost:3000/reset-password?token=")
	mfaMasterKey := os.Getenv("MFA_MASTER_KEY")
	ssoMasterKey := os.Getenv("SSO_MASTER_KEY")
	webURL := envOr("WEB_URL", "http://localhost:3000")

	// Notification publisher: shared by the mailer AND the auth service so
	// login / password-reset events are routed to notification-svc.
	// Declared before auth construction so both Auth and PasswordReset get the
	// same live publisher once NATS becomes available.
	var notifPub notiflib.Publisher = notiflib.NoopPublisher{}
	// Mailer: use NotifSvcMailer (NATS → email channel) when NATS is available;
	// fall back to LogMailer in dev environments where NATS is absent.
	var mailer service.Mailer = service.NewLogMailer()
	if natsClient != nil {
		if np, err := notiflib.NewJetStreamPublisher(natsClient); err != nil {
			log.Warn().Err(err).Msg("notif publisher init failed — mailer will use LogMailer")
		} else {
			notifPub = np
			mailer = service.NewNotifSvcMailer(np)
			log.Info().Msg("mailer: using NotifSvcMailer (NATS)")
		}
	}

	auth := service.NewAuth(users, store.NewSessions(p), signer, pub, notifPub).
		WithRefreshTokens(tokens, refreshTTL).
		WithMFA(mfaEnrollments)
	refresh := service.NewRefresh(users, tokens, signer, pub)

	passwordReset := service.NewPasswordReset(users, tokens, resets, mailer, pub, resetTTL, resetLinkURL, notifPub)
	ssoConfigs := store.NewSSOConfigs(p)

	// MFA service is OPTIONAL at boot: an empty MFA_MASTER_KEY skips the
	// endpoints entirely so dev environments without an externally-supplied
	// key still come up. Production MUST set the key — if anyone has
	// confirmed_at on a row and the key is missing, login still functions
	// (step-up returns mfa_required), but challenge/enroll/verify won't be
	// reachable. Operators get a Warn log so this isn't silent.
	var mfaSvc *service.MFA
	if mfaMasterKey != "" {
		m, err := service.NewMFA(mfaEnrollments, users, mfaMasterKey, signer, pub)
		if err != nil {
			log.Fatal().Err(err).Msg("mfa init failed")
		}
		mfaSvc = m
	} else {
		log.Warn().Msg("MFA_MASTER_KEY not set — /v1/auth/mfa/* endpoints disabled")
	}

	// OIDC service is OPTIONAL at boot: an empty SSO_MASTER_KEY skips the
	// federation endpoints entirely so dev environments without an externally
	// supplied key still come up. Production MUST set the key.
	var oidcSvc *service.OIDC
	if ssoMasterKey != "" {
		o, err := service.NewOIDC(ssoConfigs, users, auth, p, ssoMasterKey, webURL, pub)
		if err != nil {
			log.Fatal().Err(err).Msg("oidc init failed")
		}
		oidcSvc = o
	} else {
		log.Warn().Msg("SSO_MASTER_KEY not set — /v1/auth/oidc/* and /v1/admin/sso/* endpoints disabled")
	}

	var _ libauth.Authorizer = authz // compile-time interface check
	h := api.NewRouterFullWithOIDC(auth, refresh, passwordReset, mfaSvc, oidcSvc, kp, keyStore, issuer, authz, authz, p)
	h = api.WithUserList(h, keyStore, issuer, users)

	// Service-to-service token endpoint. OPTIONAL at boot: an empty
	// SERVICE_TOKEN_SECRET leaves the endpoint UNMOUNTED entirely (404) so no
	// token can ever be minted with an empty secret. When set, callers on the
	// internal network present the secret via X-Service-Secret to mint a
	// short-lived JWT for cross-service Cedar-gated calls.
	serviceSecret := os.Getenv("SERVICE_TOKEN_SECRET")
	svcToken := service.NewServiceToken(signer, serviceSecret, pub)
	if svcToken.Enabled() {
		h = api.WithServiceToken(h, svcToken)
		log.Info().Msg("service-token endpoint enabled (POST /v1/internal/service-token)")
	} else {
		log.Warn().Msg("SERVICE_TOKEN_SECRET not set — POST /v1/internal/service-token disabled")
	}

	// Wrap with a thin mux that exposes /metrics before the OTEL HTTP handler.
	mux := chi.NewRouter()
	mux.Get("/metrics", libotel.PrometheusHandler().ServeHTTP)
	mux.Mount("/", h)
	tracedHandler := otelhttp.NewHandler(mux, "identity-svc")
	srv := &http.Server{Addr: ":" + port, Handler: tracedHandler, ReadHeaderTimeout: 5 * time.Second}

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
