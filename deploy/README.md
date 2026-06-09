# MajiFlow — Deployment Guide

MajiFlow runs as **one container**: a single Go binary (`maji-server`) that is

- **PocketBase-as-library** — SQLite database, auth, file storage, and it serves the built
  Angular SPA + the `/api/farmon` REST API + the `/_/` admin dashboard, all on one HTTP port, and
- an **embedded MQTT broker** (Mochi) that devices connect to.

There is no separate database, broker, Home Assistant, or ChirpStack to run — the old multi-service
Raspberry-Pi stack is gone.

```
                 Internet
                    │
            Coolify (HTTPS, :443)            devices ──► MQTT
                    │                          1883 (plain) / 8883 (TLS)
        ┌───────────┼──────────────────────────────┼─────────┐
        │  maji-server container                    │         │
        │   HTTP :8090  (SPA + /api + /_/)  ◄────────┘         │
        │   embedded MQTT broker                                │
        │   volume → /pb_data (SQLite + files + logs + backups) │
        └──────────────────────────────────────────────────────┘
```

---

## Quick start (local)

```bash
cp .env.example .env      # then edit .env (see Configuration)
docker compose up --build
```

Open `http://localhost:8090` and log in with `MAJI_ADMIN_EMAIL` / `MAJI_ADMIN_PASSWORD`.

> The image is built from the repo-root `Dockerfile` (multi-stage: builds the Angular SPA, builds
> the Go binary, ships a small Alpine runtime). `docker-compose.yml` is at the repo root.

---

## Ports

| Port | Purpose | Exposure |
|------|---------|----------|
| 8090 | HTTP — SPA, `/api/farmon`, `/_/` admin | Behind Coolify's HTTPS proxy → your domain |
| 8883 | TLS MQTT (device-facing) | Raw TCP. Published by default; serves when `MAJI_MQTT_TLS_ENABLED=true` |
| 1883 | Plain MQTT (device-facing) | **Not published by default** — opt-in for local/LAN via the override below |

The base `docker-compose.yml` publishes only 8090 + 8883, so managed/cloud is TLS-only (no plaintext on
the internet). For a trusted-LAN on-prem box that wants plain 1883, copy
[`docker-compose.override.example.yml`](../docker-compose.override.example.yml) → `docker-compose.override.yml`
(git-ignored; auto-merged by local `docker compose`, ignored by Coolify's explicit `-f`). The broker
always binds 1883 inside the container; the override only re-exposes it on the host.

The browser MQTT-over-WebSocket listener (`:8082`) is not used by the SPA and is not exposed.

---

## Configuration

All infra config is environment variables — see [`.env.example`](../.env.example), which ships two
labelled profiles:

- **Profile A — Managed cloud:** TLS on (`MAJI_MQTT_TLS_ENABLED=true`) with a mounted cert; firmware
  is baked to reach `MAJI_MQTT_PUBLIC_HOST:8883` over TLS.
- **Profile B — On-prem / edge:** TLS off, no certificate at all; firmware reaches the box's LAN IP
  on plain `:1883`.

The `MAJI_MQTT_PUBLIC_*` trio is what gets **baked into generated firmware**, so it must point at
whichever listener actually serves devices and match its TLS setting.

Business rules (e.g. the managed per-site device cap) are **not** env — they live in the `app_config`
DB collection and are tuned from the admin **Settings** page.

### Two admin identities

| Identity | What it is | How it's created |
|----------|-----------|------------------|
| **App admin** | The SPA login (`users`, `role=admin`) | Seeded on first boot from `MAJI_ADMIN_EMAIL` / `MAJI_ADMIN_PASSWORD` |
| **Superuser** | The `/_/` PocketBase dashboard login | Bootstrapped idempotently by the entrypoint from `MAJI_SUPERUSER_EMAIL` / `MAJI_SUPERUSER_PASSWORD` |

---

## Device-facing TLS

TLS is a single flag so on-prem deploys need no certificates:

- `MAJI_MQTT_TLS_ENABLED=false` (default) → plain `:1883` only, no cert.
- `MAJI_MQTT_TLS_ENABLED=true` → the broker also serves `:8883` using `MAJI_MQTT_TLS_CERT` /
  `MAJI_MQTT_TLS_KEY` (PEM paths). The server refuses to start if the flag is on but the cert/key
  are missing.

Mount only the two PEMs at `/certs` (keep them **out** of the data volume): `fullchain.pem`
(a **single self-signed** cert — issuer == subject) and `privkey.pem`. There is no `ca.pem` to mount
— the server reads the cert from `fullchain.pem` and bakes it into firmware as the device's pinned
`certificate_authority`. The device pins that exact cert: esp-idf mbedTLS rejects a two-tier
self-signed CA chain but trusts a self-signed cert it finds byte-identical in its store. So
**replacing the cert re-flashes the fleet** (no separate issuer to rotate behind). `docker-compose.yml`
declares the two as **file** bind mounts (`./deploy/certs/fullchain.pem:/certs/fullchain.pem`, same
for `privkey.pem`):

- **Coolify (managed):** a compose service's storage is derived from those volume lines, so the two
  appear under **Storages → Files** — paste the cert + key contents there and Coolify writes them to
  the source path and mounts them. (Directory/Files tabs are otherwise greyed for compose resources.)
- **Local on-prem TLS test:** run `deploy/gen-selfsigned-certs.sh` first so the source files exist;
  otherwise Docker creates empty directories in their place.

On-prem default (TLS off) never reads `/certs`, so the empty source is harmless.

Cert custody: there is no separate CA key — `privkey.pem` is the only secret, and it lives on the
broker (as it must to terminate TLS). Back it up offline. Devices do **not** check cert expiry
(`CONFIG_MBEDTLS_HAVE_TIME_DATE` is off), so a 10-yr cert never forces a reflash on its own — only a
deliberate key rotation (e.g. after compromise) does, and that re-flashes the fleet. Regenerate with
`deploy/gen-selfsigned-certs.sh` and OTA the new cert before swapping the broker's.

---

## Persistence

**One stateful boundary: the `/pb_data` volume.** It holds everything that must outlive the
container — the SQLite database, uploaded files (`storage/`: board SVGs, committed firmware bundle
zips), logs, and backups. Nothing else needs persisting: the MQTT broker is in-memory by design
(telemetry is stored in the DB; devices re-announce on reconnect), so a restart loses nothing.

The compose file uses a **named** volume, so the host/orchestrator owns where the bytes live and the
storage backend stays swappable.

### File storage — local now, S3 later

File blobs currently live in `/pb_data/storage/` inside the volume. When blob growth (especially the
30 MB `firmware_bin`) justifies it, switch PocketBase **Files storage** and **Backups** to any
S3-compatible bucket from the `/_/` dashboard — no code change. The box then holds only the live
SQLite (which must stay on a real filesystem). **Caveat:** PocketBase does not backfill — copy the
existing `storage/` blobs into the bucket once when you switch.

---

## Coolify

1. New resource → **Docker Compose** from this repo (root `docker-compose.yml`).
2. Set the env vars (Profile A for managed). Attach `fullchain.pem` + `privkey.pem` as **file mounts**
   at `/certs/fullchain.pem` and `/certs/privkey.pem` (matching `MAJI_MQTT_TLS_CERT` / `_KEY`).
3. Map the domain to port **8090** (Coolify terminates HTTPS). Do **not** add the MQTT host as a
   Coolify domain — it's raw TCP, not HTTP, and the proxy can't carry it (it'll error).
4. Open **8883** in the VPS firewall (raw TCP). Managed is TLS-only — do **not** open 1883.
   Cloudflare: the MQTT subdomain must be **DNS-only (grey)**; it bypasses the proxy to the host port.
5. The `pb_data` volume is managed by Coolify — confirm it's persistent before going live.
6. Deploy. Coolify rebuilds and redeploys on every push (no CI/CD config needed here).

---

## First run

1. `MAJI_ADMIN_*` and `MAJI_SUPERUSER_*` create the two logins on first boot.
2. Log in to the app as the admin.
3. **Import boards before generating firmware.** A fresh database has an empty board catalog by
   design — generation needs at least the boards your controllers reference (admin → Boards → import
   the `board.yaml` + SVG).
4. Design a site, provision/generate a controller, flash, and confirm it shows `online` with
   telemetry on the dashboard.

> **Production gotcha:** don't edit collection **schema** via `/_/` in production. The schema is
> owned by the compiled Go migrations; the dashboard's auto-migration would try to write migration
> files into the read-only image and fail. Editing **records** (and `app_config`) is fine.

---

## Security checklist

- [ ] Strong, unique `MAJI_ADMIN_PASSWORD` and `MAJI_SUPERUSER_PASSWORD`.
- [ ] `MAJI_MQTT_TLS_ENABLED=true` for any internet-facing (managed) deploy; cert/key mounted.
- [ ] `MAJI_MQTT_PUBLIC_*` matches the listener devices actually use (port + TLS).
- [ ] Domain served only over HTTPS (Coolify).
- [ ] `pb_data` volume is backed up (volume snapshots now; PocketBase → S3 backups later).
