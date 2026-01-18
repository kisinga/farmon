# SX1302 Gateway HAT Setup

Hardware setup for Waveshare SX1302 LoRaWAN Gateway HAT.

## Prerequisites

- SX1302 HAT connected to Pi GPIO
- SPI enabled: `sudo raspi-config` → Interface Options → SPI
- Docker stack running: `docker-compose up -d`

## Install

```bash
sudo bash setup_gateway.sh
```

Installs and configures:
- `chirpstack-concentratord-sx1302` (SPI → ZeroMQ)
- `chirpstack-mqtt-forwarder` (ZeroMQ → MQTT)

## Verify

```bash
# Check services
sudo systemctl status chirpstack-concentratord
sudo systemctl status chirpstack-mqtt-forwarder

# View logs
sudo journalctl -fu chirpstack-concentratord

# Check MQTT traffic
docker exec farm-mosquitto mosquitto_sub -t 'us915/gateway/#' -v -C 3
```

Gateway should appear in ChirpStack UI → Gateways.

## Register Gateway (after database reset)

If gateway doesn't auto-register:

1. Get gateway EUI:
   ```bash
   sudo journalctl -u chirpstack-mqtt-forwarder | grep gateway_id | tail -1
   ```

2. In ChirpStack:
   - Tenants → Gateways → Add
   - Gateway ID: (16-char hex from step 1)
   - Name: `farm-gateway`

## Waveshare HAT GPIO

| Signal | GPIO |
|--------|------|
| Reset | 23 |
| Power Enable | 18 |
| SPI | /dev/spidev0.0 |

## Configuration Files

| File | Purpose |
|------|---------|
| `/etc/chirpstack-concentratord/concentratord.toml` | Hardware config |
| `/etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml` | MQTT connection |

## Troubleshooting

### "Failed to set SX1250 in STANDBY_RC mode"
Wrong GPIO pins or HAT not seated properly.

### Gateway shows "Never seen"
Topic prefix mismatch between MQTT Forwarder and ChirpStack:
```bash
cat /etc/chirpstack-mqtt-forwarder/mqtt-forwarder.toml | grep topic_prefix
# Must match ChirpStack region config (us915 or eu868)
```

### SPI not found
```bash
sudo raspi-config  # Enable SPI
sudo reboot
ls /dev/spidev*    # Should show spidev0.0
```

## Service Management

```bash
sudo systemctl restart chirpstack-concentratord chirpstack-mqtt-forwarder
sudo systemctl stop chirpstack-concentratord chirpstack-mqtt-forwarder
```
