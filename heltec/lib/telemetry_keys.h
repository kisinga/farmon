#pragma once

// Centralized definition of telemetry keys for consistency and size optimization.
// Using short keys saves precious bytes in the LoRa payload.
namespace TelemetryKeys {
    // Water
    constexpr const char* PulseDelta = "pd";      // Pulses since last report (uint16_t)
    constexpr const char* TotalVolume = "tv";     // Total daily volume (float, liters) - calculated on relay, but sent by remote for display sync
    
    // Battery
    constexpr const char* BatteryPercent = "bp";  // Battery percentage (uint8_t)

    // System - error categories (failure points)
    constexpr const char* ErrorCount = "ec";           // Total (sum of no_ack + join_fail + send_fail) for backward compat
    constexpr const char* ErrorNoAck = "ec_na";        // Confirmed uplink sent, no ACK received
    constexpr const char* ErrorJoinFail = "ec_jf";    // OTAA join attempt failed
    constexpr const char* ErrorSendFail = "ec_sf";    // sendData failed (pre-check or radio error)
    constexpr const char* TimeSinceReset = "tsr";      // Time since last daily reset (uint32_t, seconds)
}
