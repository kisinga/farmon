#include "core_system.h"
#include "core_logger.h"
#include "board_config.h"
#include <Arduino.h>
#define HELTEC_NO_DISPLAY_INSTANCE  // Disable global display creation
#include <heltec_unofficial.h>

CoreSystem::CoreSystem() {}

void CoreSystem::init(const DeviceConfig& config) {
    // 1. Initialize Board Hardware using Heltec library
    heltec_setup();

    // 2. Serial is already initialized by heltec_setup()
    delay(500); // Longer delay to ensure serial is ready
    Serial.println();

    // 3. Initialize Logger
    char deviceIdStr[4];
    snprintf(deviceIdStr, sizeof(deviceIdStr), "%02X", config.deviceId);
    Logger::safeInitialize(deviceIdStr);
    Logger::setLevel(Logger::Level::Info);

    // Ensure Serial is ready before logging (with timeout)
    uint32_t startTime = millis();
    while (!Serial && (millis() - startTime) < 2000) { // 2 second timeout
        delay(10);
    }

    Logger::printf(Logger::Level::Info, "SYS", "Core system initializing...");

    // 4. Enable external power for peripherals
    heltec_ve(true);

    Logger::printf(Logger::Level::Info, "SYS", "Core system initialized.");
}
