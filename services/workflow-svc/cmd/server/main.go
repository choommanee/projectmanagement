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

	"github.com/pmplatform/services/workflow-svc/internal/api"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

func main() {
	dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
	port := envOr("PORT", "8089")
	runtimeURL := envOr("WORKFLOW_RUNTIME_URL", "http://localhost:8090")

	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer p.Close()

	svc := service.New(
		store.NewDefinitions(p),
		store.NewVersions(p),
		store.NewInstances(p),
		store.NewHumanTasks(p),
		runtimeURL,
	)
	h := api.NewRouter(svc)
	srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

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
