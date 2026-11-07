# syntax=docker/dockerfile:1
# Static company website (SWK Solution) served by Caddy.
# Build context = repo root. On Railway set RAILWAY_DOCKERFILE_PATH=swk-solution/Dockerfile
FROM caddy:2-alpine
COPY swk-solution /srv
COPY swk-solution/Caddyfile /etc/caddy/Caddyfile
# Railway injects PORT; the Caddyfile listens on it and sets cache headers.
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
