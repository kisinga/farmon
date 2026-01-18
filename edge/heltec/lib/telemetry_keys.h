#pragma once

// Centralized definition of telemetry keys for consistency and size optimization.
// Using short keys saves precious bytes in the LoRa payload.
namespace TelemetryKeys {
    // Water
    constexpr const char* PulseDelta = "pd";      // Pulses since last report (uint16_t)
    constexpr const char* TotalVolume = "tv";     // Total daily volume (float, liters) - calculated on relay, but sent by remote for display sync
    
    // Battery
    constexpr const char* BatteryPercent = "bp";  // Battery percentage (uint8_t)

    // System
    constexpr const char* ErrorCount = "ec";      // Cumulative error count (uint32_t)
    constexpr const char* TimeSinceReset = "tsr"; // Time since last daily reset (uint32_t, seconds)
}
