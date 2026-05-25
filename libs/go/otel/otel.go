package otel

import (
	"context"
	"net/http"
	"os"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

type Config struct {
	ServiceName  string
	OTLPEndpoint string
}

type Shutdown func(context.Context) error

func Init(ctx context.Context, cfg Config) (Shutdown, error) {
	res, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			resource.Default().SchemaURL(),
			attribute.String("service.name", cfg.ServiceName),
		))
	if err != nil {
		return nil, err
	}

	if cfg.OTLPEndpoint == "" {
		tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res))
		otel.SetTracerProvider(tp)
		return tp.Shutdown, nil
	}

	exp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(cfg.OTLPEndpoint),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	return tp.Shutdown, nil
}

// SetupOTLP is a convenience wrapper around Init that reads
// OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME from the environment.
// It returns a no-arg shutdown function that flushes traces on service exit.
// If OTEL_EXPORTER_OTLP_ENDPOINT is empty, a no-op tracer provider is installed
// (tracing disabled) — the service still starts cleanly.
func SetupOTLP(ctx context.Context, serviceName string) (func(), error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	// OTEL_SERVICE_NAME env may override the compiled-in service name.
	if name := os.Getenv("OTEL_SERVICE_NAME"); name != "" {
		serviceName = name
	}
	shutdown, err := Init(ctx, Config{
		ServiceName:  serviceName,
		OTLPEndpoint: endpoint,
	})
	if err != nil {
		return nil, err
	}
	return func() { _ = shutdown(context.Background()) }, nil
}

// PrometheusHandler returns the default Prometheus metrics HTTP handler.
// Mount it at GET /metrics in every service.
func PrometheusHandler() http.Handler {
	return promhttp.Handler()
}
