#pragma once

// =============================================================================
// LoRaWAN Credentials
// =============================================================================
//
// SETUP:
//   1. Copy this file:  cp secrets.example.h secrets.h
//   2. Get values from ChirpStack (see below)
//   3. Edit secrets.h with your values
//
// HOW TO GET THESE VALUES:
//
//   1. Open ChirpStack UI: http://<pi-ip>:8080
//   2. Login (default: admin / admin)
//   3. Go to: Tenants → Applications → [your app] → Devices → [your device]
//   4. Click "OTAA keys" tab
//
//   AppEUI (JoinEUI):
//     - Usually all zeros for ChirpStack v4
//     - Or copy from Application settings if set
//
//   AppKey:
//     - Click "Generate" to create a new key, OR
//     - Enter your own 32-character hex string
//     - Copy the key (e.g., "0102030405060708090a0b0c0d0e0f10")
//     - Convert to bytes: 0x01, 0x02, 0x03, ...
//
// =============================================================================

// AppEUI - Usually all zeros for ChirpStack v4
static const uint8_t LORAWAN_APP_EUI[8] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

// AppKey - 16 bytes from ChirpStack OTAA Keys tab
// Example: if ChirpStack shows "0102030405060708090a0b0c0d0e0f10"
// Convert to: 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
//             0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
static const uint8_t LORAWAN_APP_KEY[16] = {
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};
