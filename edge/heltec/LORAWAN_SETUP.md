# LoRaWAN Setup Guide

This guide covers the complete setup for the Far-Mon LoRaWAN network, including ChirpStack configuration, device provisioning, and payload decoding.

## Prerequisites

- Raspberry Pi with SX1302 LoRaWAN gateway
- ChirpStack v4 installed and running
- Heltec ESP32 LoRa V3 remote devices
- MQTT broker (Mosquitto) for ThingsBoard integration

## Architecture Overview

```
Remote Devices ──► SX1302 Gateway ──► ChirpStack ──► MQTT ──► ThingsBoard
     (OTAA)            (UDP)         (Network)      (JSON)   (Dashboard)
```

---

## 1. ChirpStack Configuration

### 1.1 Create Device Profile

1. Navigate to **Device Profiles** → **Create**
2. Configure the profile:

| Setting | Value |
|---------|-------|
| Name | `far-mon-sensor` |
| Region | `EU868` (or your region) |
| MAC Version | `LoRaWAN 1.0.3` |
| Regional Parameters | `RP002-1.0.1` |
| ADR Algorithm | `Default ADR algorithm` |
| Expected uplink interval | `60` seconds |
| Device Class | `Class A` |
| Supports OTAA | ✓ Enabled |

3. Under **Codec**, add the JavaScript decoder (see section 4)

### 1.2 Create Application

1. Navigate to **Applications** → **Create**
2. Configure:

| Setting | Value |
|---------|-------|
| Name | `farm-monitoring` |
| Description | `Farm sensor monitoring application` |

### 1.3 Generate Fleet Credentials

For the fleet, generate shared credentials:

```bash
# Generate AppEUI (JoinEUI)
openssl rand -hex 8
# Example: 0000000000000001

# Generate AppKey (shared secret)
openssl rand -hex 16
# Example: 00000000000000000000000000000001
```

**Important**: Store these securely and update `remote/config.h` with the actual values.

---

## 2. Device Provisioning

### 2.1 DevEUI Derivation

Each device's DevEUI is automatically derived from its ESP32 chip ID:

```cpp
// In core_config.cpp
void getDevEuiFromChipId(uint8_t* devEui) {
    uint64_t chipId = ESP.getEfuseMac();
    devEui[0] = (chipId >> 0) & 0xFF;
    devEui[1] = (chipId >> 8) & 0xFF;
    devEui[2] = (chipId >> 16) & 0xFF;
    devEui[3] = 0xFF;
    devEui[4] = 0xFE;
    devEui[5] = (chipId >> 24) & 0xFF;
    devEui[6] = (chipId >> 32) & 0xFF;
    devEui[7] = (chipId >> 40) & 0xFF;
}
```

### 2.2 Adding a Device to ChirpStack

1. Power on the device and check serial output for DevEUI:
   ```
   DevEUI: AA:BB:CC:FF:FE:DD:EE:FF
   ```

2. In ChirpStack, navigate to your application → **Devices** → **Create**

3. Configure:

| Setting | Value |
|---------|-------|
| Name | `remote-01` (or descriptive name) |
| Device EUI | (from serial output, no colons) |
| Device Profile | `far-mon-sensor` |

4. After creating, set the OTAA keys:
   - **Application Key**: (your shared AppKey)

### 2.3 Firmware Configuration

Update `remote/config.h` with your credentials:

```cpp
// AppEUI from ChirpStack
static const uint8_t LORAWAN_APP_EUI[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
};

// AppKey from ChirpStack (keep secret!)
static const uint8_t LORAWAN_APP_KEY[16] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01
};
```

---

## 3. Payload Format

### 3.1 Uplink Payload (Port 1)

Telemetry is sent as compact CSV format:
```
key:value,key:value,...
```

Example:
```
bat:85,pd:12,vol:45.23,err:0,tsr:3600
```

| Key | Description | Unit |
|-----|-------------|------|
| `bat` | Battery percentage | % |
| `pd` | Pulse delta (water flow since last reading) | pulses |
| `vol` | Total volume | liters |
| `err` | Error count | count |
| `tsr` | Time since reset | seconds |

### 3.2 Downlink Commands

Commands are sent to specific ports:

| Port | Command | Payload |
|------|---------|---------|
| 10 | Reset water volume | (none) |
| 11 | Set reporting interval | 4 bytes, big-endian ms |
| 12 | Reboot device | (none) |

---

## 4. ChirpStack Payload Codec

Add this JavaScript decoder to the device profile:

```javascript
// Decode uplink payload
function decodeUplink(input) {
    var data = {};
    
    // Convert bytes to string
    var payload = "";
    for (var i = 0; i < input.bytes.length; i++) {
        payload += String.fromCharCode(input.bytes[i]);
    }
    
    // Parse CSV format: key:value,key:value,...
    var pairs = payload.split(",");
    for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split(":");
        if (kv.length === 2) {
            var key = kv[0];
            var value = kv[1];
            
            // Map short keys to full names
            var keyMap = {
                "bat": "battery_percent",
                "pd": "pulse_delta",
                "vol": "total_volume",
                "err": "error_count",
                "tsr": "time_since_reset"
            };
            
            var fullKey = keyMap[key] || key;
            
            // Parse value
            if (value === "nan") {
                data[fullKey] = null;
            } else if (value.indexOf(".") !== -1) {
                data[fullKey] = parseFloat(value);
            } else {
                data[fullKey] = parseInt(value);
            }
        }
    }
    
    return {
        data: data
    };
}

// Encode downlink payload
function encodeDownlink(input) {
    var bytes = [];
    
    if (input.data.command === "set_interval" && input.data.interval_ms) {
        var interval = input.data.interval_ms;
        bytes.push((interval >> 24) & 0xFF);
        bytes.push((interval >> 16) & 0xFF);
        bytes.push((interval >> 8) & 0xFF);
        bytes.push(interval & 0xFF);
    }
    
    return {
        bytes: bytes,
        fPort: input.data.port || 1
    };
}
```

---

## 5. ThingsBoard Integration

### 5.1 MQTT Integration

Configure ChirpStack to publish to MQTT:

1. In ChirpStack, navigate to **Network Server** → **Integrations**
2. Add MQTT integration with:
   - Server: `tcp://localhost:1883`
   - Topic prefix: `application/{{application_id}}/device/{{dev_eui}}`

### 5.2 ThingsBoard Device

1. Create device in ThingsBoard
2. Use MQTT integration to receive data
3. Configure dashboard widgets for:
   - Battery level gauge
   - Water flow rate chart
   - Total volume display
   - Device status indicator

---

## 6. Troubleshooting

### Device Not Joining

1. Check serial output for DevEUI
2. Verify DevEUI is registered in ChirpStack
3. Confirm AppKey matches between device and ChirpStack
4. Check gateway is receiving join requests (ChirpStack logs)
5. Verify regional settings match (EU868, US915, etc.)

### No Uplinks Received

1. Check device has successfully joined (serial: "Successfully joined network")
2. Verify gateway is forwarding packets
3. Check ChirpStack device events for uplinks
4. Confirm port and payload format

### Downlinks Not Working

1. Verify device is in Class A RX windows after uplink
2. Check ChirpStack shows downlink queued
3. Confirm port number matches command handler

---

## 7. Security Considerations

1. **Keep AppKey Secret**: Never commit real keys to version control
2. **Use Environment Variables**: Consider using build-time key injection
3. **Rotate Keys**: If compromised, regenerate AppKey and update all devices
4. **Secure MQTT**: Use TLS for MQTT connections in production
5. **Network Isolation**: Keep ChirpStack on isolated network segment
