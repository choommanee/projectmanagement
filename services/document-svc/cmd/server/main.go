package main

import (
	"context"
	"encoding/json"
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

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8084")

	// OTEL tracing: non-fatal; service still starts if collector is unreachable.
	if otelShutdown, err := libotel.SetupOTLP(context.Background(), "document-svc"); err != nil {
		log.Warn().Err(err).Msg("OTEL setup failed — continuing without tracing")
	} else {
		defer otelShutdown()
	}

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

	// NATS: notification publisher + domain-event emitter (document.sign_*).
	// Both degrade to no-ops when NATS is unavailable so the service still boots.
	var notifPub notiflib.Publisher = notiflib.NoopPublisher{}
	var emitter service.EventEmitter = service.NoopEmitter{}
	if natsURL := os.Getenv("NATS_URL"); natsURL != "" {
		if nc, err := natsx.Connect(natsURL); err != nil {
			log.Warn().Err(err).Msg("nats unavailable — sign notifications/events disabled")
		} else {
			defer nc.Close()
			if pub, err := notiflib.NewJetStreamPublisher(nc); err != nil {
				log.Warn().Err(err).Msg("notif publisher init failed")
			} else {
				notifPub = pub
			}
			if e, err := newDocEventEmitter(nc); err != nil {
				log.Warn().Err(err).Msg("doc event emitter init failed")
			} else {
				emitter = e
			}
		}
	}

	svc := service.New(
		store.NewWorkspaces(p),
		store.NewDocuments(p),
		store.NewComments(p),
		store.NewTemplates(p),
	).WithSignatures(store.NewSignatures(p)).
		WithVerifyLinks(store.NewVerifyLinks(p)).
		WithNotifPublisher(notifPub).
		// Platform audit_log publisher (direct Postgres write — works with NATS
		// down). Separate from the signing hash-chain sign_event trail.
		WithAuditPublisher(audit.NewPgPublisher(p, "document-svc")).
		WithEventEmitter(emitter)
	// Trust layer: key custody provider, RFC 3161 TSA, platform cert (trust.go).
	wireTrust(context.Background(), p, svc)
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
	tracedHandler := otelhttp.NewHandler(mux, "document-svc")
	srv := &http.Server{Addr: ":" + port, Handler: tracedHandler, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("document-svc listening")
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

// docEventEmitter publishes document.sign_* domain events on the DOCEVENTS
// JetStream stream (subjects "document.>"). workflow-svc subscribes to
// "document.sign_requested" for its trigger listener.
type docEventEmitter struct{ c *natsx.Client }

func newDocEventEmitter(c *natsx.Client) (*docEventEmitter, error) {
	if err := c.EnsureStream(context.Background(), "DOCEVENTS", []string{"document.>"}); err != nil {
		return nil, err
	}
	return &docEventEmitter{c: c}, nil
}

func (e *docEventEmitter) Emit(ctx context.Context, subject string, payload map[string]any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return e.c.Publish(ctx, subject, data)
}
