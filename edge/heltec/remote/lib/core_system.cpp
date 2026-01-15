#include "core_system.h"
#include "core_logger.h"
#include "board_config.h"
#include <Arduino.h>
#include "LoRaWan_APP.h" // For Mcu.begin()

CoreSystem::CoreSystem() {}

void CoreSystem::init(const DeviceConfig& config) {
    // 1. Initialize Board Hardware
    Mcu.begin(HELTEC_BOARD, SLOW_CLK_TPYE);

    // 2. Initialize Serial
    Serial.begin(115200);
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

    // 4. (Future) Initialize other core components here
    // For example, power management (vext), etc.

    Logger::printf(Logger::Level::Info, "SYS", "Core system initialized.");
}
