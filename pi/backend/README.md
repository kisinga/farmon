# pi — PocketBase backend (LoRaWAN + codec + Concentratord)

Farm monitor backend: **Concentratord (ZMQ)** → backend (LoRaWAN join/decrypt, codec, SQLite) → HTTP API. Single stack: no ChirpStack, MQTT, Postgres or Redis.

## Quick start

```bash
cd pi/backend
go mod tidy
go build -o pocketbase .
./pocketbase serve --http=0.0.0.0:8090
```

First run creates `pb_data` and prompts for a superuser. Collections (devices, telemetry, lorawan_sessions, etc.) are created on first request (bootstrap).

## Device provisioning (LoRaWAN OTAA)

1. **Create device and get AppKey**  
   `POST /api/devices` with body `{ "device_eui": "0102030405060708", "device_name": "pump-1" }`  
   Returns `{ "device_eui": "...", "app_key": "32 hex chars" }`.

2. **Get credentials for firmware**  
   `GET /api/devices/credentials?eui=0102030405060708`  
   Returns `{ "device_eui": "...", "app_key": "..." }` for use in Heltec `secrets.h` or build tooling.

Use the same `device_eui` (16 hex chars, from device label/serial) and put `app_key` in firmware; device joins via OTAA and the backend creates the session automatically.

## Concentratord (gateway)

Gateway configuration is **stored in the database only** and set from the **Gateway** settings page in the UI (`/settings`). There are no `CONCENTRATORD_*` environment variables.

1. **First run**: Open the app → **Gateway** (or `/settings`). The form is pre-filled with defaults (e.g. event_url `ipc:///tmp/concentratord_event`, command_url `ipc:///tmp/concentratord_command`, region US915). Edit if needed and click **Save**.
2. **Save = enable**: Once valid settings (event_url, command_url, region) are saved, the backend starts the concentratord pipeline (ZMQ connect, uplink/downlink). Until then, no concentratord traffic is handled.
3. **Optional — manage concentratord**: If you enable "Manage concentratord process", the backend writes `pb_data/concentratord.toml` and starts the concentratord binary (default `/usr/local/bin/chirpstack-concentratord-sx1302`). Otherwise, concentratord must be running already (e.g. via `pi/setup_gateway.sh` or systemd).

Uplinks are received over ZMQ, decrypted (LoRaWAN), decoded (native Go codec), and stored. Join requests are answered with JoinAccept; data uplinks are decoded and written to devices/telemetry/state_changes. Downlink (e.g. setControl) is sent via Concentratord.

## Build and run

- **Local**: `go build -o pocketbase . && ./pocketbase serve --http=0.0.0.0:8090`
- **Docker with pre-built binary** (from `pi/`): Run `make dist-pi` on your machine (builds frontend + backend for linux/arm64 into `dist/`). Commit `dist/` and push. On the Pi: `git pull && docker compose up -d`. The image only copies `dist/pocketbase` and `dist/pb_public/` (no build in container).
- **Docker build on device**: If you didn't commit `dist/`, uncomment the build stages in `backend/Dockerfile` and point the runtime stage at `--from=backend` and `--from=frontend`; then `docker compose build` from `pi/`.

## API summary

- `POST /api/devices` — provision device (body: `device_eui`, `device_name`); returns `app_key`.
- `GET /api/devices/credentials?eui=...` — get credentials for firmware.
- `POST /api/setControl` — enqueue downlink (body: `eui`, `control`, `state`, `duration?`). Requires Concentratord configured.
- `GET /api/gateway-settings` — get gateway settings (or defaults when none saved). `PATCH /api/gateway-settings` — save settings and start/restart pipeline.
- `GET /api/gateway-status` — list gateways (gateway_id from settings or auto-discovered from concentratord).
- `GET /api/history?eui=...&field=...&from=...&to=...&limit=500` — telemetry history.
- `POST /api/otaStart`, `POST /api/otaCancel` — OTA (eui in body).

## Gateway setup (Concentratord only)

On the Pi with the SX1302 HAT:

1. **Install the concentratord binary** (once): `sudo bash pi/setup_gateway.sh`. This installs `chirpstack-concentratord-sx1302` to `/usr/local/bin/`.
2. In the UI open **Gateway** settings, enable **Manage concentratord process**, set region (EU868 or US915), and Save. The backend writes TOML and starts the process.

See `docs/concentratord-api.md` for the ZMQ API.

## Troubleshooting: no uplinks / join requests

The UI shows "Gateway" as connected when valid gateway settings are saved and the backend has connected to concentratord. If you see no frames and logs like:

```text
concentratord SUB dial: ... connect: no such file or directory (retry in 5s)
```

then **concentratord is not running** (or not creating the IPC sockets the backend expects).

**On the Pi (host):**

1. **Check concentratord is running**  
   `sudo systemctl status chirpstack-concentratord`  
   If it is not active, start it:  
   `sudo systemctl start chirpstack-concentratord`

2. **Check the IPC sockets exist**  
   `ls -la /tmp/concentratord_event /tmp/concentratord_command`  
   You should see socket files. If not, concentratord did not start correctly (check `sudo journalctl -u chirpstack-concentratord -n 50`).

3. **If the backend runs in Docker** on the same Pi, ensure the compose file mounts the host `/tmp` so the container can reach IPC sockets.

4. **Ensure gateway settings are saved** in the UI (**Gateway** → fill event_url, command_url, region → Save). The pipeline does not start until valid settings exist in the DB.

The backend retries connecting to concentratord every 5 seconds. Once concentratord is running and settings are saved, join requests and uplinks will appear.
