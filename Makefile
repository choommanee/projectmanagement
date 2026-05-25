.PHONY: obs-up obs-down jaeger grafana

# Bring up the local observability stack (otel-collector, Jaeger, Prometheus, Grafana)
obs-up:
	docker compose -f infra/compose/observability.yml up -d

# Tear down the local observability stack
obs-down:
	docker compose -f infra/compose/observability.yml down

# Open Jaeger trace UI in the default browser
jaeger:
	open http://localhost:16686

# Open Grafana dashboards in the default browser
grafana:
	open http://localhost:3001
