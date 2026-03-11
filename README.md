![FarMon Logo](docs/images/logo.svg)

# FarMon

**Monitor your farm. From far. Farm on!**

LoRaWAN-based farm monitoring and automation with long-range sensors and local data processing.

## Architecture

```
┌─────────────────┐      LoRaWAN       ┌─────────────────────────┐
│  Heltec Sensors │ ──────────────────►│  SX1302 Gateway         │
└─────────────────┘                    │  (Concentratord)        │
                                       └────────────┬────────────┘
                                                    │ ZMQ
                                       ┌────────────▼────────────┐
                                       │  Raspberry Pi            │
                                       │  PocketBase (Go) +       │
                                       │  Angular UI              │
                                       │  SQLite, LoRaWAN codec   │
                                       └────────────┬────────────┘
                                                    │ Tailscale
                                       ┌────────────▼────────────┐
                                       │  Remote Access          │
                                       └─────────────────────────┘
```

→ [docs/FIRMWARE_ARCHITECTURE.md](docs/FIRMWARE_ARCHITECTURE.md) — firmware layers (lib, integrations, devices). Backend and gateway: [pi/backend/README.md](pi/backend/README.md).

## Setup Guide

### Step 1: Set up the gateway

On the Pi with the SX1302 HAT, install and run Concentratord:

```bash
sudo bash pi/setup_gateway.sh
```

→ Full details: [pi/backend/README.md#gateway-setup-concentratord-only](pi/backend/README.md#gateway-setup-concentratord-only)

**Verify:** Backend logs show connection to concentratord when env vars are set (see backend README).

### Step 2: Run the backend and frontend

**Option A — Pre-built (recommended for Pi):** From your dev machine:

```bash
cd pi
make dist-pi
# Commit dist/ and push; on the Pi:
git pull && docker compose up -d
```

**Option B — Local dev:** See [pi/backend/README.md](pi/backend/README.md) and [pi/frontend/README.md](pi/frontend/README.md).

### Step 3: Deploy sensors

For each Heltec device:

1. **Provision in backend:** `POST /api/devices` with `{ "device_eui": "0102030405060708", "device_name": "pump-1" }` (use DevEUI from device label/serial). Copy the returned `app_key`.
2. **Get credentials for firmware:** `GET /api/devices/credentials?eui=0102030405060708` — use the `app_key` in Heltec `secrets.h`.
3. **Configure & flash:**
   ```bash
   cd heltec
   cp secrets.example.h secrets.h
   # Edit secrets.h with your AppKey (from step 1 or 2)
   ./heltec.sh flash main
   ```

→ Full details: [pi/backend/README.md#device-provisioning-lorawan-otaa](pi/backend/README.md#device-provisioning-lorawan-otaa), [heltec/README.md](heltec/README.md).

**Verify:** Serial shows "joined"; backend UI or API shows uplinks and device state.

## Services

| Service        | URL                |
|----------------|--------------------|
| FarMon (API + UI) | `http://<pi>:8090` |

(Login is created on first run; see [pi/backend/README.md](pi/backend/README.md).)

## Project structure

```
far-mon/
├── pi/backend/   # PocketBase (Go), LoRaWAN codec, Concentratord ZMQ
├── pi/frontend/  # Angular UI
├── pi/setup_gateway.sh
└── heltec/       # Sensor firmware (Heltec ESP32 LoRaWAN)
```

## Troubleshooting

| Problem              | Check |
|----------------------|--------|
| Gateway not appearing | `sudo systemctl status chirpstack-concentratord`; backend env `CONCENTRATORD_*` set? |
| Device not joining   | AppKey exact match? Region matches gateway? |
| No uplinks           | Concentratord running? Backend logs: "concentratord SUB connected"? See [pi/backend/README.md#troubleshooting-no-uplinks--join-requests](pi/backend/README.md#troubleshooting-no-uplinks--join-requests). |
