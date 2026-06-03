#pragma once

// Centralized definition of telemetry keys for consistency and size optimization.
// Using short keys saves precious bytes in the LoRa payload.
namespace TelemetryKeys {
    // Water
    constexpr const char* PulseDelta = "pd";      // Pulses since last report (uint16_t)
    constexpr const char* TotalVolume = "tv";     // Total daily volume (float, liters) - calculated on relay, but sent by remote for display sync

    // Battery
    constexpr const char* BatteryPercent = "bp";  // Battery percentage (uint8_t)

    // Error object: ec = total; sub-keys by category (keys ≤2 chars). All reset daily.
    constexpr const char* ErrorCount = "ec";   // Total (sum of all sub-counters)
    // Communication
    constexpr const char* ErrorNoAck = "na";    // Confirmed uplink sent, no ACK received
    constexpr const char* ErrorJoinFail = "jf"; // OTAA join attempt failed
    constexpr const char* ErrorSendFail = "sf"; // sendData failed (pre-check or radio error)
    // Hardware
    constexpr const char* ErrorSensorRead = "sr";  // Sensor read failed
    constexpr const char* ErrorDriver = "dr";      // Driver (relay/GPIO/UART) failed
    constexpr const char* ErrorDisplay = "dp";     // Display failed
    // OTA
    constexpr const char* ErrorOtaCrc = "cs";     // CRC/checksum mismatch
    constexpr const char* ErrorOtaWrite = "wf";   // Flash write failed
    constexpr const char* ErrorOtaTimeout = "tm"; // Timeout/incomplete
    // System
    constexpr const char* ErrorMemory = "mm";    // Memory/heap
    constexpr const char* ErrorQueueFull = "qf"; // Queue full
    constexpr const char* ErrorTask = "ts";      // Task/scheduler
    // Logic
    constexpr const char* ErrorRule = "rf";       // Rule execution failed
    constexpr const char* ErrorConfig = "cv";    // Config validation failed
    constexpr const char* ErrorPersistence = "pf"; // Persistence failed

    constexpr const char* TimeSinceReset = "tsr"; // Time since last daily reset (uint32_t, seconds)
}
