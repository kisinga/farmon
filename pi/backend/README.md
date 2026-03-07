# piv2 — ChirpStack + PocketBase + Angular

Farm monitor stack: ChirpStack (HTTP integration, no MQTT) → PocketBase (Go extension) + Angular (DaisyUI). Single binary goal; data in PocketBase SQLite.

## Phase 1 — Infra and uplink pipeline

### Prerequisites

- Docker and Docker Compose
- Go 1.23+ (for local build)
- For gateway uplinks: add an MQTT broker (e.g. `mosquitto`) to the compose and point ChirpStack region config to it, or use ChirpStack UDP gateway bridge.

### Build PocketBase binary (local)

```bash
cd piv2
go mod tidy   # or go get ./... — requires network
go build -o pocketbase .
./pocketbase serve --http=0.0.0.0:8090
```

First run creates `pb_data` and prompts for a superuser. ChirpStack webhook: `POST /api/chirpstack?event=up` (and other events).

### Run with Docker Compose

```bash
cd piv2
docker compose up -d --build
```

- ChirpStack API: http://localhost:8080  
- PocketBase (API + admin): http://localhost:8090  

ChirpStack is configured to POST integration events to `http://pocketbase:8090/api/chirpstack`. On first start, PocketBase creates `devices` and `telemetry` collections if missing (bootstrap).

### Persistence

- `piv2_pb_data` volume holds PocketBase SQLite and uploads. Preserved across container restarts and redeploys.

### ChirpStack HTTP config

Edit `chirpstack/server/chirpstack.toml`: `[integration]` → `enabled = ["http"]`, `[integration.http]` → `event_endpoint`, `json = true`. No MQTT.

### Build Angular and embed in PocketBase (single binary)

```bash
cd piv2/frontend
npm install
npx ng build
cd ..
go build -tags embed -o pocketbase .
./pocketbase serve --http=0.0.0.0:8090
```

The Angular app is then served at `/`. Without `-tags embed`, serve the frontend from `pb_public` (e.g. copy `frontend/dist/farmmon/browser/*` to `pb_public/`) or use `ng serve` for dev.

### PocketBase collection rules

For the frontend to read devices/telemetry without auth, set the collection **List** and **View** rules to empty in the PocketBase admin (`/_/`), or configure rules as needed.

---

## Backup and restore

- **Backup**: Copy the `pb_data` volume (or bind mount) that holds PocketBase SQLite and uploads.
- **Restore**: Replace `pb_data` with the backup and restart the PocketBase container.

## Optional: migrate data from pi/ (Postgres)

To import existing devices/telemetry from the current `pi/` farmmon Postgres database into PocketBase, export from Postgres (e.g. `pg_dump` or custom script) and insert into PocketBase via the Admin API or by seeding the SQLite `pb_data` database. No script is included; document the schema mapping (see plan) and run a one-off migration if needed.
