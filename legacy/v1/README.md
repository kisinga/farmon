![FarMon Logo](docs/images/logo.svg)

# FarMon

**Monitor your farm. From far. Farm on!**

Monitor tanks, pumps, soil, and livestock—and automate valves and rules—from one place. Everything runs on your own gateway, so automation keeps working even when the internet doesn’t.

---

## What is FarMon?

FarMon is a farm monitoring and automation system that uses long-range wireless (LoRaWAN) to connect sensors and devices to a small computer (gateway) on your farm. You see levels, flows, and sensor data in one dashboard and set rules that run on the gateway—so they keep working when the internet is down. Start with one tank and one pump; add more tanks, boreholes, soil sensors, and livestock trackers as you need them.

## Who is it for?

- **Best fit:** Medium and larger operations with multiple tanks, boreholes, or paddocks. Automate water across tanks, monitor soil moisture in many spots, or track livestock over kilometres—one LoRaWAN network can cover a large area with a single gateway.
- **Starting small:** Begin with one tank and one pump (e.g. remote on/off and level), then add sensors, tanks, and automation later. The same system grows with you.
- **Simple remote control:** If you only need to turn water on or off from your phone today, FarMon may be more than you need—but you can add tanks, valves, and rules later without changing systems, and there’s no monthly subscription. [When it makes economic sense →](docs/ECONOMIC_ANALYSIS.md)

## What can you do?

- **Water:** Multiple tanks (level, fill/empty). Rules like *when tank 1 is full, close valve 1 and open valve 2* for tank 2. Multiple sources: boreholes, mains, rainwater. Pumps and valves: remote control and rules (e.g. run pump only when tank below X).
- **Power:** Mix solar, inverter, and mains; monitor or switch by source and battery.
- **Soil:** Soil moisture sensors across fields on the same LoRaWAN network as tanks and pumps.
- **Livestock & assets:** Track goats, cows, or equipment over several kilometres on the same network.
- **Offline automation:** Rules run on the gateway. Valves, pumps, and alerts keep working when the internet is down; you only need connectivity to view the dashboard remotely.

## Why FarMon?

- **Runs locally** — Automation runs on your gateway; no cloud required for valves and pumps.
- **No subscription** — One-time hardware and setup; no per-device or per-month fees.
- **Scales** — One tank to many tanks, boreholes, sensors, and trackers on one network.
- **Extensible** — Add new sensors, rules, and integrations at relatively low cost; the stack is built for it.

---

## How it works

Sensors and devices talk to a gateway (e.g. Raspberry Pi with a LoRaWAN radio) over long-range wireless. The gateway runs the FarMon app (dashboard, rules, storage). Open the dashboard on your phone or computer—optionally over a private link (e.g. Tailscale) when you’re away.

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

Firmware and backend: [Firmware architecture](docs/FIRMWARE_ARCHITECTURE.md) · [Backend & gateway](pi/backend/README.md)

---

## Getting started

**What you’ll need:** Raspberry Pi with SX1302 LoRaWAN gateway HAT (or equivalent), FarMon-compatible sensors (e.g. Heltec ESP32). Optional: Tailscale for remote dashboard access.

### Step 1: Set up the gateway

On the Pi with the LoRaWAN HAT:

```bash
sudo bash pi/setup_gateway.sh
```

Then start concentratord (see [pi/concentratord/README.md](pi/concentratord/README.md) for region/config). Full details: [Gateway setup](pi/backend/README.md#gateway-setup-concentratord-only).

### Step 2: Run the FarMon app

**Option A — Pre-built (recommended on Pi):** From your dev machine:

```bash
cd pi
make dist-pi
# Commit dist/ and push; on the Pi:
git pull && docker compose up -d
```

**Option B — Local dev:** [Backend](pi/backend/README.md) · [Frontend](pi/frontend/README.md)

### Step 3: Deploy sensors

For each device: register it in the app (e.g. name it `pump-1` or `tank-1`), get the key, put the key in the device firmware, then flash. Example for Heltec:

1. In the app (or via API): create device with its DevEUI and name; copy the returned `app_key`.
2. In firmware: put `app_key` in `heltec/secrets.h`. Build and flash: `./heltec.sh flash main`.

Details: [Device provisioning](pi/backend/README.md#device-provisioning-lorawan-otaa) · [Heltec firmware](heltec/README.md)

---

## Accessing FarMon

**Dashboard:** `http://<your-pi-ip>:8090` (or your Tailscale hostname).

First run: the app prompts you to create an admin account. See [Backend](pi/backend/README.md).

---

## Troubleshooting

| Problem | What to check |
|--------|----------------|
| Gateway not online | Gateway service running on Pi: `sudo systemctl status chirpstack-concentratord`. In app: **LoRaWAN → Gateway configuration** → set event URL, command URL, region → **Save**. [Gateway setup](pi/backend/README.md#gateway-setup-concentratord-only) |
| Device not joining | AppKey in firmware must match app exactly; gateway region (EU868/US915) must match devices. [Provisioning](pi/backend/README.md#device-provisioning-lorawan-otaa) · [Heltec](heltec/README.md) |
| No uplinks | Gateway running and reachable by the app (e.g. if app is in Docker, ensure it can reach gateway sockets). [No uplinks](pi/backend/README.md#troubleshooting-no-uplinks--join-requests) |

---

## For developers

**Project structure:** `pi/backend/` — app server (PocketBase, LoRaWAN, concentratord). `pi/frontend/` — web dashboard (Angular). `pi/setup_gateway.sh` — gateway installer. `heltec/` — example sensor firmware (Heltec ESP32 LoRaWAN).

**Docs:** [Backend & gateway](pi/backend/README.md) · [Frontend](pi/frontend/README.md) · [Heltec firmware](heltec/README.md) · [Concentratord config](pi/concentratord/README.md) · [Firmware architecture](docs/FIRMWARE_ARCHITECTURE.md) · [Economics & when FarMon makes sense](docs/ECONOMIC_ANALYSIS.md)
