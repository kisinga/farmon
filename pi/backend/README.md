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

Uplinks and downlinks go through Concentratord. Set:

- **CONCENTRATORD_EVENT_URL** and **CONCENTRATORD_COMMAND_URL** (ZMQ), e.g.  
  `ipc:///tmp/concentratord_event` and `ipc:///tmp/concentratord_command`.
- **CONCENTRATORD_GATEWAY_ID** (optional) for downlink targeting and gateway-status in the UI.
- **CONCENTRATORD_REGION** — Set to `EU868` or `US915` to select the region profile used for RX1 frequency and modulation (downlink logic). Should match the concentratord TOML region (see `pi/setup_gateway.sh [eu868|us915]`). Channel configuration is file-based; the backend does not push gateway config.
- **CONCENTRATORD_RX1_DELAY** (optional, default `1`) — Class A RX1 delay in seconds (1–15). Must match the device’s first receive window; use `5` if the device or region expects 5s.
- **CONCENTRATORD_RX1_FREQUENCY_HZ** (optional) — Downlink frequency in Hz for RX1. If unset, the backend may use the uplink frequency (e.g. EU868). Set if the gateway reports TX_FREQ in the downlink ack.

Uplinks are received over ZMQ, decrypted (LoRaWAN), decoded (native Go codec), and stored. Join requests are answered with JoinAccept; data uplinks are decoded and written to devices/telemetry/state_changes. Downlink (e.g. setControl) is sent via Concentratord. If these env vars are unset, provisioning and data APIs still work but no radio traffic is handled and setControl returns an error.

## Build and run

- **Local**: `go build -o pocketbase . && ./pocketbase serve --http=0.0.0.0:8090`
- **Docker with pre-built binary** (from `pi/`): Run `make dist-pi` on your machine (builds frontend + backend for linux/arm64 into `dist/`). Commit `dist/` and push. On the Pi: `git pull && docker compose up -d`. The image only copies `dist/pocketbase` and `dist/pb_public/` (no build in container).
- **Docker build on device**: If you didn't commit `dist/`, uncomment the build stages in `backend/Dockerfile` and point the runtime stage at `--from=backend` and `--from=frontend`; then `docker compose build` from `pi/`.

## API summary

- `POST /api/devices` — provision device (body: `device_eui`, `device_name`); returns `app_key`.
- `GET /api/devices/credentials?eui=...` — get credentials for firmware.
- `POST /api/setControl` — enqueue downlink (body: `eui`, `control`, `state`, `duration?`). Requires Concentratord configured.
- `GET /api/gateway-status` — list gateways (CONCENTRATORD_GATEWAY_ID when set).
- `GET /api/history?eui=...&field=...&from=...&to=...&limit=500` — telemetry history.
- `POST /api/otaStart`, `POST /api/otaCancel` — OTA (eui in body).

## Gateway setup (Concentratord only)

On the Pi with the SX1302 HAT:

```bash
sudo bash pi/setup_gateway.sh eu868   # or us915
```

Set **CONCENTRATORD_REGION** to match (e.g. `EU868` or `US915`). Then run the backend with `CONCENTRATORD_EVENT_URL` and `CONCENTRATORD_COMMAND_URL` set to the IPC paths (see script output). See `docs/concentratord-api.md` for the ZMQ API.

## Troubleshooting: no uplinks / join requests

The UI shows "Gateway" as connected when the backend has the concentratord env vars set. That does **not** mean the backend is actually connected to concentratord. If you see no frames and logs like:

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

3. **If the backend runs in Docker** on the same Pi, ensure the compose file mounts the host `/tmp` (e.g. `volumes: - /tmp:/tmp`) so the container can reach those sockets.

The backend **retries** connecting to concentratord every 5 seconds. Once concentratord is running, the backend will connect and you should see `concentratord SUB connected to ipc:///tmp/concentratord_event` in the logs; join requests and uplinks will then appear.
