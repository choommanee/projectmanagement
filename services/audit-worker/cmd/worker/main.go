package main

import (
	"context"
	"encoding/json"
	"os"
	"os/signal"
	"syscall"

	"github.com/rs/zerolog/log"

	"github.com/pmplatform/libs/go/audit"
	natsx "github.com/pmplatform/libs/go/nats"

	"github.com/pmplatform/services/audit-worker/internal/sink"
)

func main() {
	natsURL := envOr("NATS_URL", "nats://localhost:4222")
	chDSN := envOr("CLICKHOUSE_DSN", "clickhouse://localhost:9000/audit")

	c, err := natsx.Connect(natsURL)
	if err != nil {
		log.Fatal().Err(err).Send()
	}
	defer c.Close()
	if err := c.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"}); err != nil {
		log.Fatal().Err(err).Send()
	}

	s, err := sink.NewCH(chDSN)
	if err != nil {
		log.Fatal().Err(err).Send()
	}

	_, err = c.Subscribe(context.Background(), "AUDIT", "audit.>", func(data []byte) error {
		var ev audit.Event
		if err := json.Unmarshal(data, &ev); err != nil {
			return err
		}
		return s.Insert(context.Background(), ev)
	})
	if err != nil {
		log.Fatal().Err(err).Send()
	}

	log.Info().Msg("audit-worker consuming audit.>")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
