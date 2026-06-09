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
	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"
	natsx "github.com/pmplatform/libs/go/nats"
	notiflib "github.com/pmplatform/libs/go/notification"
	libotel "github.com/pmplatform/libs/go/otel"
	"github.com/pmplatform/libs/go/serviceauth"
	libpolicy "github.com/pmplatform/libs/policy"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/pmplatform/services/workflow-svc/internal/api"
	"github.com/pmplatform/services/workflow-svc/internal/docsvc"
	"github.com/pmplatform/services/workflow-svc/internal/scheduler"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
	"github.com/pmplatform/services/workflow-svc/internal/trigger"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8090")
	runtimeURL := envOr("WORKFLOW_RUNTIME_URL", "http://localhost:19090")

	// OTEL tracing: non-fatal; service still starts if collector is unreachable.
	if otelShutdown, err := libotel.SetupOTLP(context.Background(), "workflow-svc"); err != nil {
		log.Warn().Err(err).Msg("OTEL setup failed — continuing without tracing")
	} else {
		defer otelShutdown()
	}

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	var notifPub notiflib.Publisher = notiflib.NoopPublisher{}
	var triggerListener *trigger.Listener
	if natsURL := os.Getenv("NATS_URL"); natsURL != "" {
		if nc, err := natsx.Connect(natsURL); err != nil {
			log.Warn().Err(err).Msg("nats unavailable — notif events + triggers disabled")
		} else {
			if pub, err := notiflib.NewJetStreamPublisher(nc); err != nil {
				log.Warn().Err(err).Msg("notif publisher init failed")
			} else {
				notifPub = pub
			}
			// Wire is deferred so svc is built first; Start is called after.
			defer nc.Close()
			triggerListener = trigger.New(nil, nc.Conn()) // svc attached below
		}
	}

	templatesStore := store.NewTemplates(p)
	instancesStore := store.NewInstances(p)
	svc := service.New(
		store.NewDefinitions(p),
		store.NewVersions(p),
		instancesStore,
		store.NewHumanTasks(p),
		runtimeURL,
	).WithNotifPublisher(notifPub).WithTemplates(templatesStore)

	// Audit trail: direct Postgres writer (no NATS dependency). Every
	// significant mutation is recorded in audit_log via the api emit helper.
	svc.WithAudit(audit.NewPgPublisher(p, "workflow-svc"))

	// Service-to-service auth: mint a "workflow-service" bearer token (per tenant)
	// that the runtime engine forwards to document-svc / project-svc on signature
	// + task calls. Without SERVICE_TOKEN_SECRET we degrade gracefully — the
	// runtime still runs, cross-service calls just go unauthenticated (local dev).
	identityURL := envOr("IDENTITY_URL", "http://localhost:8082")
	var sa *serviceauth.Client
	if secret := os.Getenv("SERVICE_TOKEN_SECRET"); secret != "" {
		sa = serviceauth.New(identityURL, secret, "workflow-svc")
		svc = svc.WithServiceAuth(sa)
		log.Info().Str("identity_url", identityURL).Msg("serviceauth enabled — forwarding service token to runtime")
	} else {
		log.Warn().Msg("SERVICE_TOKEN_SECRET unset — runtime cross-service calls will be unauthenticated (degraded local dev)")
	}

	if triggerListener != nil {
		triggerListener.AttachService(svc)
		triggerListener.Start(context.Background())
		defer triggerListener.Stop()
	}

	// Background timer poller: wakes paused instances whose wait-step timer
	// (wake_at) has elapsed and resumes them. Interval via WAKE_POLL_INTERVAL.
	pollInterval := 30 * time.Second
	if v := os.Getenv("WAKE_POLL_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			pollInterval = d
		}
	}
	poller := scheduler.New(svc, instancesStore, pollInterval)
	poller.Start(context.Background())
	defer poller.Stop()

	// NATS-free fallback for the request_signature leg: this poller reads each
	// paused instance's envelope status straight from document-svc and resumes
	// when terminal. NATS (trigger.Listener) remains the instant path; both
	// funnel through ResumeBySignature, which is idempotent (see signature_poller.go).
	// Interval via SIGN_POLL_INTERVAL, falling back to WAKE_POLL_INTERVAL.
	signInterval := pollInterval
	if v := os.Getenv("SIGN_POLL_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			signInterval = d
		}
	}
	docClient := docsvc.New(envOr("DOCUMENT_SVC_URL", "http://localhost:8084"))
	// Pass the concrete minter only when configured so a nil *serviceauth.Client
	// doesn't masquerade as a non-nil interface inside the poller.
	var signAuth scheduler.SignatureMinter
	if sa != nil {
		signAuth = sa
	}
	signPoller := scheduler.NewSignaturePoller(svc, instancesStore, docClient, signAuth, signInterval)
	signPoller.Start(context.Background())
	defer signPoller.Stop()

	ps, err := libpolicy.LoadShared()
	if err != nil {
		log.Fatal().Err(err).Msg("load cedar policy bundle")
	}
	authz := &libpolicy.Adapter{Policies: ps}

	// Plan #6 Task 6 — wire the Cedar resource loader.
	loader := api.NewCedarLoader(p)
	h := api.NewRouterWithLoader(svc, authz, loader)

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
	tracedHandler := otelhttp.NewHandler(mux, "workflow-svc")
	srv := &http.Server{Addr: ":" + port, Handler: tracedHandler, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Str("runtime", runtimeURL).Msg("workflow-svc listening")
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
