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

	"github.com/pmplatform/services/mfg-svc/internal/api"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8085")
	mrpEngineURL := envOr("MRP_ENGINE_URL", "http://localhost:8086")

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

	svc := service.New(items, wcs, boms, routings, workOrders, mrp, mrpEngineURL)
	h := api.NewRouter(svc)
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
