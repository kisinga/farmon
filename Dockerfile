# syntax=docker/dockerfile:1

# ── Stage 1: build the Angular SPA ───────────────────────────────────────────
# Debian (glibc), not alpine (musl): package-lock.json is resolved on glibc, so a
# glibc builder keeps `npm ci` in sync. On musl, npm wants the musl variants of
# native deps (rollup/lightningcss/tailwind-oxide + their @emnapi/@napi-rs WASM
# fallback) which a glibc-generated lockfile omits → `npm ci` aborts "out of sync".
# This stage is throwaway anyway: only the built SPA is copied to the alpine runtime.
FROM node:24.16-slim AS web
WORKDIR /build
# Pin npm to the version that generated package-lock.json. The base image bundles
# a newer npm whose peer-dep resolution wants top-level @emnapi entries an older
# npm omits, so `npm ci` rejects the lockfile as "out of sync". Rule: this version
# must match the npm you run `npm install` with locally; bump both together.
RUN npm i -g npm@11.6.2
# Install deps against the lockfile first (cached unless deps change).
COPY package.json package-lock.json ./
RUN npm ci
# Source needed for the production build.
COPY angular.json tsconfig.json tsconfig.app.json .postcssrc.json ngsw-config.json ./
COPY src ./src
COPY public ./public
RUN npm run build
# → /build/dist/app/browser

# ── Stage 2: build the Go server (cloud binary) ──────────────────────────────
FROM golang:1.25-alpine AS api
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
