# syntax=docker/dockerfile:1
# Static company website (SWK Solution) served by Caddy.
# Build context = repo root. On Railway set RAILWAY_DOCKERFILE_PATH=swk-solution/Dockerfile
FROM caddy:2-alpine
COPY swk-solution /srv
# Railway injects PORT; serve the static folder on it.
CMD ["sh", "-c", "caddy file-server --root /srv --listen :${PORT:-80}"]
