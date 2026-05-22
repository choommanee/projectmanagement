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

	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/quality-svc/internal/api"
	"github.com/pmplatform/services/quality-svc/internal/service"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8087")

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	apqp := store.NewAPQP(p)
	ppap := store.NewPPAP(p)
	fmea := store.NewFMEA(p)
	cp := store.NewControlPlan(p)
	insp := store.NewInspection(p)
	ncr := store.NewNCR(p)

	svc := service.New(apqp, ppap, fmea, cp, insp, ncr)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		log.Fatal().Err(err).Msg("load cedar policy bundle")
	}
	authz := &libpolicy.Adapter{Policies: ps}

	// Plan #6 Task 6 — wire the Cedar resource loader.
	loader := api.NewCedarLoader(p)
	h := api.NewRouterWithLoader(svc, authz, loader)
	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

	go func() {
		log.Info().Str("addr", srv.Addr).Msg("quality-svc listening")
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
