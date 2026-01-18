// WiFi Manager - Actual WiFi implementation for Heltec WiFi LoRa 32 V3
// Provides real WiFi connectivity and status monitoring

#pragma once

#include <WiFi.h>
#include "core_logger.h"

class WifiManager {
public:
    struct Config {
        const char* ssid = nullptr;
        const char* password = nullptr;
        uint32_t reconnectIntervalMs = 30000; // 30 seconds
        uint32_t statusCheckIntervalMs = 5000; // 5 seconds
    };

    explicit WifiManager(const Config& config) : cfg(config), initialized(false) {}

    const Config& getConfig() const { return cfg; }

    // Safe begin that prevents double initialization
    // Returns true if initialization was performed, false if already initialized
    bool safeBegin() {
        if (initialized) {
            return false; // Already initialized
        }
        unsafeBegin();
        return true;
    }
    
    // Public update API used by services/transports
    void update(uint32_t nowMs) {
        // The ESP32 WiFi stack handles auto-reconnection automatically.
        // We just need to periodically check the status.
        if (nowMs - lastStatusCheck >= cfg.statusCheckIntervalMs) {
            lastStatusCheck = nowMs;

            // Log periodic status for debugging
            LOGD("WiFi", "Periodic status check - Connected: %s, WiFi.status()=%d, RSSI=%ddBm",
                         isConnected() ? "Yes" : "No", WiFi.status(), getRSSI());
        }
    }

    bool isConnected() const {
        return WiFi.status() == WL_CONNECTED;
    }

    // Get signal strength as percentage (0-100)
    int8_t getSignalStrengthPercent() const {
        if (!isConnected()) return -1;

        int32_t rssi = WiFi.RSSI();
        // Convert RSSI to percentage (typical range: -100 to -30 dBm)
        // RSSI of -30dBm = 100%, RSSI of -100dBm = 0%
        int8_t percent = map(rssi, -100, -30, 0, 100);
        return constrain(percent, 0, 100);
    }

    // Get raw RSSI value
    int32_t getRSSI() const {
        return isConnected() ? WiFi.RSSI() : 0;
    }

    // Get connection info for debugging
    void printStatus() const {
        Serial.print(F("[WiFi] INFO "));
        Serial.println(F("Connection Status Report:"));
        Serial.print(F("[WiFi] INFO "));
        Serial.printf("  Status: %s\n", isConnected() ? "Connected" : "Disconnected");
        Serial.print(F("[WiFi] INFO "));
        Serial.printf("  RSSI: %ddBm (%d%% signal strength)\n",
             getRSSI(), getSignalStrengthPercent());
        Serial.print(F("[WiFi] INFO "));
        Serial.printf("  IP Address: %s\n",
             isConnected() ? WiFi.localIP().toString().c_str() : "N/A");

        if (isConnected()) {
            Serial.print(F("[WiFi] INFO "));
            Serial.printf("  Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
            Serial.print(F("[WiFi] INFO "));
            Serial.printf("  DNS: %s\n", WiFi.dnsIP().toString().c_str());
            Serial.print(F("[WiFi] INFO "));
            Serial.printf("  Subnet: %s\n", WiFi.subnetMask().toString().c_str());
            Serial.print(F("[WiFi] INFO "));
            Serial.printf("  MAC Address: %s\n", WiFi.macAddress().c_str());
        } else {
            Serial.print(F("[WiFi] INFO "));
            Serial.printf("  Connection attempts: %lu\n", WiFi.getMode());
            Serial.print(F("[WiFi] INFO "));
            Serial.printf("  WiFi mode: %s\n", WiFi.getMode() == WIFI_STA ? "STA" : "AP");
        }
    }

    // Uplink helper: placeholder for HTTP/MQTT/etc. Currently logs payload.
    // Returns true if accepted for send.
    bool uplink(const uint8_t* payload, uint8_t length) {
        if (!payload || length == 0) {
            Serial.print(F("[WiFi] DEBUG "));
            Serial.println(F("Uplink rejected: invalid payload (null or zero length)"));
            return false;
        }
        if (!isConnected()) {
            Serial.print(F("[WiFi] WARN "));
            Serial.println(F("Uplink rejected: not connected to WiFi"));
            return false;
        }

        Serial.print(F("[WiFi] DEBUG "));
        Serial.printf("Uplink accepted: %u bytes\n", length);
        Serial.print(F("[WiFi] VERBOSE "));
        Serial.printf("Payload: %.*s\n", length, payload);
        return true;
    }

private:
    // Internal unsafe begin - should not be called directly
    void unsafeBegin() {
        if (!cfg.ssid || !cfg.password) {
            Serial.print(F("[WiFi] ERROR "));
            Serial.println(F("No SSID/password configured - cannot connect"));
            Serial.print(F("[WiFi] DEBUG "));
            Serial.printf("SSID: %s, Password: %s\n",
                 cfg.ssid ? cfg.ssid : "NULL",
                 cfg.password ? "***" : "NULL");
            return;
        }

        // Ensure logger is initialized
        if (!Logger::g_deviceId) {
            Serial.println(F("[WiFi] WARNING: Logger not initialized, using Serial fallback"));
            Serial.printf("[WiFi] Initializing connection to %s...\n", cfg.ssid);
        } else {
            LOGI("WiFi", "Initializing connection to '%s'", cfg.ssid);
        }

        WiFi.mode(WIFI_STA);
        WiFi.setAutoReconnect(true); // Ensure auto-reconnect is enabled
        WiFi.begin(cfg.ssid, cfg.password);

        initialized = true;
        LOGI("WiFi", "WiFi manager initialized successfully");
    }

private:
    Config cfg;
    uint32_t lastStatusCheck = 0;
    bool initialized;
};
