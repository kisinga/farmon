# MajiFlow — Deployment Guide

Deploy the MajiFlow infrastructure stack on a Raspberry Pi: Home Assistant, ChirpStack, ESPHome, and MQTT — everything needed to run MajiFlow-generated firmware in production.

---

## Hardware Requirements

| Component | Recommendation | Why |
|-----------|---------------|-----|
| **Single-board computer** | Raspberry Pi 4 (4 GB) or Pi 5 | Best balance of cost, power, and community support |
| **Storage** | USB SSD (Kingston A400, Samsung T7, or similar) | SD cards fail within 12 months from HA's constant database writes |
| **Power supply** | Official 15 W USB-C PSU | Cheap chargers cause brown-outs → data corruption and system crashes |
| **LoRa gateway** (optional) | SX1302 concentrator HAT | Required only if using ChirpStack for LoRaWAN devices |

---

## Prerequisites

- **Raspberry Pi OS 64-bit** (Bookworm)
- **Docker + Docker Compose** installed
- **Concentratord** installed as a systemd service (only if using SX1302 HAT)
- **Tailscale** installed at OS level (not containerised)

---

## Stack Architecture

```
                         Internet
                            │
                   Cloudflare Tunnel (HTTPS)
                            │
┌───────────────────────────┼───────────────────────────┐
│  Raspberry Pi             │                           │
│                           │                           │
│   ┌───────────────────────┼──────────────────────┐    │
│   │  Docker Compose                              │    │
│   │                                              │    │
│   │   Home Assistant (:8123)  ◄──── MQTT ────►   │    │
│   │   ESPHome (:6052)           Mosquitto        │    │
│   │                            (:1883 / :9001)   │    │
│   │   ChirpStack (:8080)  ◄──── MQTT ────►      │    │
│   │     ├── PostgreSQL                           │    │
│   │     └── Redis                                │    │
│   │   Gateway Bridge (:1700/udp)                 │    │
│   └──────────────────────────────────────────────┘    │
│                                                       │
│   Concentratord (systemd) ◄── SX1302 HAT              │
│   Tailscale (subnet router)                           │
└───────────────────────────────────────────────────────┘
```

---

## Services

### Mosquitto (MQTT Broker)

| Port | Protocol | Purpose |
|------|----------|---------|
| 1883 | MQTT | Device communication |
| 9001 | WebSocket | Browser-based MQTT clients |

- **Config**: `config/mosquitto/mosquitto.conf`
- **Security**: Anonymous access is enabled by default. For production, add authentication:
  ```bash
  docker exec mosquitto mosquitto_passwd -c /mosquitto/config/passwd <username>
  ```
  Then update `mosquitto.conf`:
  ```
  allow_anonymous false
  password_file /mosquitto/config/passwd
  ```

### PostgreSQL

ChirpStack's database. Not exposed outside Docker.

- **Default credentials**: `chirpstack` / `chirpstack` (override via `CHIRPSTACK_DB_PASSWORD` env var)
- Health check configured — ChirpStack waits for readiness before starting

### Redis

ChirpStack's session and cache store. Not exposed outside Docker. Health check configured.

### ChirpStack (LoRaWAN Network Server)

| Port | Protocol | Purpose |
|------|----------|---------|
| 8080 | HTTP | Web UI + REST API |
| 8000 | gRPC | Programmatic API (optional) |

- **Config**: `config/chirpstack/chirpstack.toml`
- **IMPORTANT**: Replace the default API secret (`you-must-replace-this-with-a-secure-secret`) before production use
- **Enabled regions**: `eu868`, `us915_0`, `au915_0` — edit `chirpstack.toml` to match your region
- **Default login**: `admin` / `admin` — change immediately on first run

### ChirpStack Gateway Bridge

Translates Concentratord / Semtech UDP packet forwarder messages into MQTT for ChirpStack.

| Port | Protocol | Purpose |
|------|----------|---------|
| 1700 | UDP | Semtech packet forwarder |

- **Config**: `config/chirpstack-gateway-bridge/chirpstack-gateway-bridge.toml`

### Home Assistant

| Port | Protocol | Purpose |
|------|----------|---------|
| 8123 | HTTP | Web UI + API |

- Runs with `network_mode: host` (required for mDNS, USB, Bluetooth discovery)
- Runs as `privileged: true` (required for hardware access)
- **Config directory**: `config/homeassistant/`

### ESPHome

| Port | Protocol | Purpose |
|------|----------|---------|
| 6052 | HTTP | Dashboard + OTA management |

- Runs with `network_mode: host` (required for mDNS discovery and USB flashing)
- Runs as `privileged: true` (required for USB serial access)
- **Config directory**: `config/esphome/`

---

## First Run

```bash
docker compose up -d
```

1. **Home Assistant** — open `http://<pi-ip>:8123`, create admin account
2. **ChirpStack** — open `http://<pi-ip>:8080`, log in as `admin`/`admin`, change password
3. **MQTT integration** — in HA, add the MQTT integration pointing to `localhost:1883`
4. **ChirpStack MQTT** — in HA, add the ChirpStack MQTT integration to receive LoRaWAN device data
5. **ESPHome** — open `http://<pi-ip>:6052` or install the ESPHome add-on in HA

---

## Remote Access

### User Access — Cloudflare Tunnel

Provides a `https://yourdomain.com` URL for the HA companion app without opening router ports.

1. Install `cloudflared` on the Pi
2. Create a tunnel pointing to `localhost:8123`
3. The HA companion app auto-switches between local IP and the tunnel URL

### Technician Access

| Method | Use Case | Setup |
|--------|----------|-------|
| **Cloudflare Tunnel** | Web UI access to HA, ChirpStack, ESPHome | Same tunnel, different subdomains |
| **Cloudflare Zero Trust** | Browser-based SSH terminal | No client install needed on the Pi user's end |
| **Tailscale subnet router** | ESPHome OTA updates + live logs | Required because Cloudflare cannot proxy the ESPHome native API |

Install Tailscale on the Pi as a subnet router to bridge your development machine to the local network for firmware flashing and live log streaming.

---

## Maintenance

### Database Management

HA's recorder writes constantly. Limit history retention to reduce SSD wear:

```yaml
# configuration.yaml
recorder:
  purge_keep_days: 10
  exclude:
    entity_globs:
      - sensor.cpu_*
      - sensor.*_signal_strength
```

### Backups

Use the Google Drive or OneDrive HA add-on for daily encrypted snapshots. Full restore to a new Pi takes approximately 10 minutes.

### Watchdog

Enable the built-in watchdog in HA add-ons to auto-restart services that hang.

---

## Security Checklist

Before exposing the stack to the internet:

- [ ] Replace ChirpStack API secret in `config/chirpstack/chirpstack.toml`
- [ ] Set `CHIRPSTACK_DB_PASSWORD` env var (or update `docker-compose.yml`)
- [ ] Add Mosquitto authentication and disable `allow_anonymous`
- [ ] Change ChirpStack default admin password
- [ ] Configure Cloudflare Access policies to restrict technician routes
- [ ] Ensure Tailscale ACLs limit subnet router access to authorised devices
