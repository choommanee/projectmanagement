package audit

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	natsx "github.com/pmplatform/libs/go/nats"
)

type Publisher struct {
	c       *natsx.Client
	service string
}

func NewPublisher(c *natsx.Client, service string) *Publisher {
	return &Publisher{c: c, service: service}
}

func (p *Publisher) Publish(ctx context.Context, action string, ev Event) error {
	if ev.ID == "" {
		ev.ID = uuid.NewString()
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	if ev.Service == "" {
		ev.Service = p.service
	}
	if ev.Action == "" {
		ev.Action = action
	}
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	return p.c.Publish(ctx, "audit."+action, data)
}
