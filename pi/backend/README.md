# piv2 — ChirpStack + PocketBase + Angular

Farm monitor stack: ChirpStack (HTTP integration, no MQTT) → PocketBase (Go extension) + Angular (DaisyUI). Single binary goal; data in PocketBase SQLite.

## Phase 1 — Infra and uplink pipeline

### Prerequisites

- Docker and Docker Compose
- Go 1.23+ (for local build)
- For gateway uplinks: add an MQTT broker (e.g. `mosquitto`) to the compose and point ChirpStack region config to it, or use ChirpStack UDP gateway bridge.

### Build PocketBase binary (local)

```bash
cd pi/backend
go mod tidy   # or go get ./... — requires network
go build -o pocketbase .
./pocketbase serve --http=0.0.0.0:8090
```

First run creates `pb_data` and prompts for a superuser. ChirpStack webhook: `POST /api/chirpstack?event=up` (and other events).

### Build for Raspberry Pi

From your dev machine, cross-compile for Linux ARM so the binary runs on a Pi (e.g. Pi 4/5, 64-bit):

```bash
cd pi/backend
go mod tidy
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -o pocketbase-linux-arm64 .
```

For 32-bit Pi (e.g. Pi Zero 2 W): `GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -o pocketbase-linux-arm .`

Copy the binary and `pb_public/` (or the embedded build, see below) to the Pi. Run: `./pocketbase-linux-arm64 serve --http=0.0.0.0:8090`.

From the **pi/** directory you can use the Makefile:

```bash
cd pi
make build-pi
```

This builds the Angular frontend, copies it to `backend/pb_public/`, and compiles the Go binary for `linux/arm64`. Copy `backend/pocketbase-pi` and `backend/pb_public/` to the Pi and run `./pocketbase-pi serve --http=0.0.0.0:8090`.

### Run with Docker Compose

```bash
cd pi
docker compose up -d --build
```

- ChirpStack API: http://localhost:8080  
- PocketBase (API + admin): http://localhost:8090  

ChirpStack is configured to POST integration events to `http://pocketbase:8090/api/chirpstack`. On first start, PocketBase creates `devices` and `telemetry` collections if missing (bootstrap).

### Persistence

- `pi_pb_data` volume holds PocketBase SQLite and uploads. Preserved across container restarts and redeploys.

### ChirpStack HTTP config

Edit `chirpstack/server/chirpstack.toml`: `[integration]` → `enabled = ["http"]`, `[integration.http]` → `event_endpoint`, `json = true`. No MQTT.

### Build Angular and embed in PocketBase (single binary)

```bash
cd pi/frontend
npm install
npm run build
cd ../backend
# Copy frontend output into backend/public (or path used by embed), then:
go build -tags embed -o pocketbase .
./pocketbase serve --http=0.0.0.0:8090
```

The Angular app is then served at `/`. Without `-tags embed`, serve the frontend from `pb_public` (e.g. copy `frontend/dist/browser/*` to `backend/pb_public/`) or use `ng serve` for dev.

### PocketBase collection rules

Bootstrap sets **List** and **View** rules to empty (public) for all app collections. Edge rules also have public **Create** and **Update** for the UI.

### ChirpStack API (downlink and gateway status)

For `POST /api/setControl` and `GET /api/gateway-status` to call ChirpStack:

- Set **CHIRPSTACK_API_URL** (e.g. `http://chirpstack-rest-api:8080` when using the REST API proxy container).
- Set **CHIRPSTACK_API_KEY** (create in ChirpStack UI: API Keys).

If unset, setControl still accepts requests and returns success (no downlink enqueued), and gateway-status returns an empty list.

### Custom API

- `GET /api/history?eui=...&field=...&from=...&to=...&limit=500` — telemetry time-series for one field (or `rssi`/`snr`).
- `POST /api/otaStart` — body `{ eui, firmware? }`.
- `POST /api/otaCancel` — body `{ eui }`.

---

## Backup and restore

- **Backup**: Copy the `pb_data` volume (or bind mount) that holds PocketBase SQLite and uploads.
- **Restore**: Replace `pb_data` with the backup and restart the PocketBase container.

## Optional: migrate data from pi/ (Postgres)

To import existing devices/telemetry from the current `pi/` farmmon Postgres database into PocketBase, export from Postgres (e.g. `pg_dump` or custom script) and insert into PocketBase via the Admin API or by seeding the SQLite `pb_data` database. No script is included; document the schema mapping (see plan) and run a one-off migration if needed.
