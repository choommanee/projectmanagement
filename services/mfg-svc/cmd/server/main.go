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
	notiflib "github.com/pmplatform/libs/go/notification"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/mfg-svc/internal/api"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8085")
	mrpEngineURL := envOr("MRP_ENGINE_URL", "http://localhost:8086")
	traceEngineURL := envOr("TRACE_ENGINE_URL", "http://localhost:8088")

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	items := store.NewItems(p)
	wcs := store.NewWorkCenters(p)
	boms := store.NewBOMs(p)
	routings := store.NewRoutings(p)
	workOrders := store.NewWorkOrders(p, boms)
	mrp := store.NewMRP(p)
	genealogy := store.NewGenealogy(p)

	var notifPub notiflib.Publisher = notiflib.NoopPublisher{}
	if natsURL := os.Getenv("NATS_URL"); natsURL != "" {
		if nc, err := natsx.Connect(natsURL); err != nil {
			log.Warn().Err(err).Msg("nats unavailable — notif events disabled")
		} else {
			if pub, err := notiflib.NewJetStreamPublisher(nc); err != nil {
				log.Warn().Err(err).Msg("notif publisher init failed")
			} else {
				notifPub = pub
				defer nc.Close()
			}
		}
	}

	svc := service.New(items, wcs, boms, routings, workOrders, mrp, genealogy, mrpEngineURL, traceEngineURL).
		WithNotifPublisher(notifPub)

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

	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("mfg-svc listening")
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
