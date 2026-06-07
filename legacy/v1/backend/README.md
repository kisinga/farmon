# pi — PocketBase backend (LoRaWAN + codec + Concentratord)

Farm monitor backend: **Concentratord (ZMQ)** → backend (LoRaWAN join/decrypt, codec, SQLite) → HTTP API. Single stack: no ChirpStack, MQTT, Postgres or Redis.

## Quick start

```bash
cd pi/backend
go mod tidy
go build -o pocketbase .
./pocketbase serve --http=0.0.0.0:8090
```

First run creates `pb_data` and prompts for a superuser. Collections (devices, telemetry, lorawan_sessions, etc.) are created automatically from JS migrations in `pb_migrations/` on `serve` (or `migrate up`).

## Device provisioning (LoRaWAN OTAA)

1. **Create device and get AppKey**  
   `POST /api/farmon/devices` with body `{ "device_eui": "0102030405060708", "device_name": "pump-1" }`  
   Returns `{ "device_eui": "...", "app_key": "32 hex chars" }`.

2. **Get credentials for firmware**  
   Use the PocketBase SDK: list/get the `devices` collection by `device_eui`, then read `app_key` from the record. Or call the same collection API directly. Returns `{ "device_eui": "...", "app_key": "..." }` for use in Heltec `secrets.h` or build tooling.

Use the same `device_eui` (16 hex chars, from device label/serial) and put `app_key` in firmware; device joins via OTAA and the backend creates the session automatically.

## Concentratord (gateway)

The backend **does not start or manage** the concentratord process. Concentratord must be running separately (e.g. on the host after `setup_gateway.sh`, or in another container), with its config binding `api.event_bind` and `api.command_bind` to the same URLs you set in the app (e.g. `ipc:///tmp/concentratord_event` and `ipc:///tmp/concentratord_command`). The backend only connects via ZMQ and can push channel config (region) at runtime via the `config` command.

Gateway configuration is **stored in the database only** and set from the **LoRaWAN** page in the UI: open **LoRaWAN**, expand the **Gateway configuration** collapsible, fill event_url, command_url, region, and click **Save**. There are no `CONCENTRATORD_*` environment variables.

1. **First run**: Open the app → **LoRaWAN** → expand **Gateway configuration**. The form is pre-filled with defaults (event_url `ipc:///tmp/concentratord_event`, command_url `ipc:///tmp/concentratord_command`, region US915). Edit if needed and click **Save**.
2. **Save = enable**: Once valid settings (event_url, command_url, region) are saved, the backend starts the concentratord pipeline (ZMQ connect, uplink/downlink). Until then, no concentratord traffic is handled.

Uplinks are received over ZMQ, decrypted (LoRaWAN), decoded (native Go codec), and stored. Join requests are answered with JoinAccept; data uplinks are decoded and written to devices/telemetry/state_changes. Downlink (e.g. setControl) is sent via Concentratord.

## Build and run

- **Local**: `go build -o pocketbase . && ./pocketbase serve --http=0.0.0.0:8090`
- **Docker with pre-built binary** (from `pi/`): Run `make dist-pi` on your machine (builds frontend + backend for linux/arm64 into `dist/`). Commit `dist/` and push. On the Pi: `git pull && docker compose up -d`. The image only copies `dist/pocketbase` and `dist/pb_public/` (no build in container).
- **Docker build on device**: If you didn't commit `dist/`, uncomment the build stages in `backend/Dockerfile` and point the runtime stage at `--from=backend` and `--from=frontend`; then `docker compose build` from `pi/`.

## API summary

Custom routes live under **`/api/farmon/`** (PocketBase SDK handles collections: devices, gateway_settings, telemetry, etc.).

- `POST /api/farmon/devices` — provision device (body: `device_eui`, `device_name`); returns `app_key`.
- `DELETE /api/farmon/devices?eui=...` — delete device and its LoRaWAN session.
- `POST /api/farmon/pipeline/restart` — reload gateway_settings from DB and restart concentratord pipeline (call after saving gateway_settings via SDK).
- `POST /api/farmon/setControl` — enqueue downlink (body: `eui`, `control`, `state`, `duration?`). Requires Concentratord configured.
- `GET /api/farmon/gateway-status` — list gateways with `online` (from last concentratord event within 2 min), `lastSeen`, and optional `discovered_gateway_id` for the settings form.
- `GET /api/farmon/debug/pipeline` — concentratord config and runtime state (online, last_event_at, sub_connected).
- `GET /api/farmon/lorawan/frames?limit=...`, `POST /api/farmon/lorawan/frames/clear`, `GET /api/farmon/lorawan/stats` — frame buffer.
- `POST /api/farmon/ota/start`, `POST /api/farmon/ota/cancel` — OTA (eui in body).

Gateway settings and telemetry history are read/written via the **PocketBase SDK** (collections `gateway_settings`, `telemetry`). After saving gateway_settings via SDK, the frontend calls `POST /api/farmon/pipeline/restart` to apply and restart the pipeline.

## Gateway setup (Concentratord only)

On the Pi with the SX1302 HAT:

1. **Install the concentratord binary** (once): `sudo bash pi/setup_gateway.sh`. This installs `chirpstack-concentratord-sx1302` to `/usr/local/bin/`.
2. **Run concentratord** on the host (or in a container) with a TOML that binds `api.event_bind` and `api.command_bind` to the same paths the app uses (e.g. `ipc:///tmp/concentratord_event`, `ipc:///tmp/concentratord_command`). Use a systemd unit or run manually; see ChirpStack concentratord docs for TOML format.
3. In the app open **LoRaWAN** → **Gateway configuration**, set region (EU868 or US915), and **Save**. The backend connects via ZMQ and optionally pushes channel config at runtime.

See `docs/concentratord-api.md` for the ZMQ API.

## Gateway online status

The UI shows the gateway as **online** when the backend has received at least one event (uplink or stats) from concentratord within the last 2 minutes. The backend subscribes to both `up` (uplinks) and `stats` (periodic gateway stats) on the concentratord ZMQ PUB socket; either type of event updates the "last seen" time. Until the first event is received after connecting, the gateway is shown as offline even if the pipeline is running.

## Troubleshooting: no uplinks / join requests

The UI shows gateway status as **online** only when events are being received (see above). If you see "Gateway offline" or no frames and logs like:

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

4. **Ensure gateway settings are saved** in the UI (**LoRaWAN** → Gateway configuration → fill event_url, command_url, region → Save). The pipeline does not start until valid settings exist in the DB.

The backend retries connecting to concentratord every 5 seconds. Once concentratord is running and settings are saved, join requests and uplinks will appear.


# ChirpStack Concentratord ZMQ API

This document describes the communication contract between the backend and ChirpStack Concentratord. Source: [ChirpStack concentratord documentation](https://www.chirpstack.io/docs/chirpstack-concentratord/).

Protobuf definitions: `api/proto/gw/gw.proto` in [chirpstack/chirpstack](https://github.com/chirpstack/chirpstack). Go package: `github.com/chirpstack/chirpstack/api/go/v4/gw`.

## Commands (ZMQ REQ)

The backend sends commands to Concentratord over a **REQ** socket. Each request is a multipart message:

- **Frame 0:** Command type (string).
- **Frame 1:** Command payload (Protobuf-encoded, or empty where noted).

| Command       | Frame 0      | Frame 1                     | Response              |
|---------------|--------------|-----------------------------|-----------------------|
| `gateway_id`  | `"gateway_id"` | empty                       | 8-byte gateway ID     |
| `down`        | `"down"`     | `DownlinkFrame` (Protobuf)   | `DownlinkTxAck` (Protobuf) |
| `config`      | `"config"`   | `GatewayConfiguration` (Protobuf) | empty             |

Channel/region configuration is **file-based** (TOML). The backend does **not** push config by default; Concentratord is configured once per HAT/region via the setup script. The `config` command is optional and model-specific (pushing a channel set that does not fit the hardware can cause the daemon to panic).

## Events (ZMQ SUB)

Concentratord publishes events on a **PUB** socket. The backend subscribes with a **SUB** socket. Each message:

- **Frame 0:** Event type (string).
- **Frame 1:** Event payload (Protobuf).

| Event   | Frame 0   | Frame 1 (payload)                                      |
|---------|-----------|--------------------------------------------------------|
| uplink  | `"up"`    | Protobuf (`Event` with `uplink_frame` or raw `UplinkFrame`) |
| stats   | `"stats"` | `GatewayStats` (Protobuf)                              |

The backend subscribes to both `"up"` and `"stats"`; receiving either type updates the gateway "last seen" time used for online status.
