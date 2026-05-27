package nats

import (
	"context"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

type Client struct {
	nc *nats.Conn
	js jetstream.JetStream
}

func Connect(url string) (*Client, error) {
	nc, err := nats.Connect(url, nats.MaxReconnects(-1))
	if err != nil {
		return nil, err
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, err
	}
	return &Client{nc: nc, js: js}, nil
}

func (c *Client) Close() { c.nc.Close() }

// Conn returns the underlying *nats.Conn for low-level subscriptions.
func (c *Client) Conn() *nats.Conn { return c.nc }

func (c *Client) EnsureStream(ctx context.Context, name string, subjects []string) error {
	_, err := c.js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:     name,
		Subjects: subjects,
		Storage:  jetstream.FileStorage,
	})
	return err
}

func (c *Client) Publish(ctx context.Context, subject string, data []byte) error {
	_, err := c.js.Publish(ctx, subject, data)
	return err
}

type Handler func(data []byte) error

func (c *Client) Subscribe(ctx context.Context, stream, subject string, h Handler) (jetstream.ConsumeContext, error) {
	cons, err := c.js.CreateOrUpdateConsumer(ctx, stream, jetstream.ConsumerConfig{
		FilterSubject: subject,
		AckPolicy:     jetstream.AckExplicitPolicy,
	})
	if err != nil {
		return nil, err
	}
	return cons.Consume(func(msg jetstream.Msg) {
		if err := h(msg.Data()); err != nil {
			_ = msg.Nak()
			return
		}
		_ = msg.Ack()
	})
}
