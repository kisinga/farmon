# syntax=docker/dockerfile:1

# ── Stage 1: build the Angular SPA ───────────────────────────────────────────
FROM node:24-alpine AS web
WORKDIR /build
# Install deps against the lockfile first (cached unless deps change).
COPY package.json package-lock.json ./
RUN npm ci
# Source needed for the production build.
COPY angular.json tsconfig.json tsconfig.app.json .postcssrc.json ./
COPY src ./src
COPY public ./public
RUN npm run build
# → /build/dist/app/browser

# ── Stage 2: build the Go server (cloud binary) ──────────────────────────────
FROM golang:1.24-alpine AS api
RUN apk add --no-cache git
WORKDIR /src
# Module graph first (cached unless go.mod/go.sum change).
COPY maji-server/go.mod maji-server/go.sum ./
RUN go mod download
COPY maji-server/ ./
# Pure-Go SQLite (modernc) → static binary, no libc needed at runtime.
RUN CGO_ENABLED=0 go build -tags cloud -trimpath -o /maji-cloud ./cmd/cloud

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
# alpine (not scratch): a shell for the superuser-bootstrap entrypoint, plus CA
# certs for any outbound TLS (SMTP/OAuth). busybox already provides wget for the
# compose healthcheck.
FROM alpine:3
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=api /maji-cloud /usr/local/bin/maji-cloud
COPY --from=web /build/dist/app/browser /app/spa
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# SPA dir is baked; everything else is runtime env (see .env.example).
ENV MAJI_SPA_DIR=/app/spa
# 8090 HTTP (SPA + /api + /_/), 1883 plain MQTT, 8883 TLS MQTT (when enabled).
EXPOSE 8090 1883 8883
# All persistent state (SQLite + storage/ + logs) lives here; mount a volume.
VOLUME /pb_data

ENTRYPOINT ["/entrypoint.sh"]
