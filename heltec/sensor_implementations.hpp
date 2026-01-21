#ifndef SENSOR_IMPLEMENTATIONS_HPP
#define SENSOR_IMPLEMENTATIONS_HPP

#include <Arduino.h>
#include "lib/core_logger.h"
#include "lib/svc_lorawan.h"
#include "lib/hal_lorawan.h"
#include "lib/common_message_types.h"
#include <vector>
#include "lib/hal_persistence.h"
#include "lib/svc_battery.h"
#include <limits>
#include "lib/core_config.h"
#include "lib/telemetry_keys.h"

// Forward-declare the config struct to avoid circular dependency
struct RemoteConfig;

// ============================================================================
// LoRaWAN Transmitter Implementation (Pure Helper)
// ============================================================================

class LoRaWANTransmitter {
public:
    LoRaWANTransmitter(ILoRaWANService* service, ILoRaWANHal* hal, const RemoteConfig& config);
    bool transmit(const std::vector<SensorReading>& readings);  // Returns success/failure
    
private:
    String formatReadings(const std::vector<SensorReading>& readings);
    bool validatePayload(const String& payload, uint8_t& maxPayload, uint8_t& currentDR);
    
    ILoRaWANService* _service;
    ILoRaWANHal* _hal;
    const RemoteConfig& _config;
};

LoRaWANTransmitter::LoRaWANTransmitter(ILoRaWANService* service, ILoRaWANHal* hal, const RemoteConfig& config)
    : _service(service), _hal(hal), _config(config) {}

bool LoRaWANTransmitter::transmit(const std::vector<SensorReading>& readings) {
    if (readings.empty()) {
        return false;
    }
    
    // Format payload
    String payload = formatReadings(readings);
    if (payload.length() == 0) {
        LOGW("LoRaWANTx", "Failed to format readings");
        return false;
    }
    
    // Validate payload size
    uint8_t maxPayload;
    uint8_t currentDR;
    if (!validatePayload(payload, maxPayload, currentDR)) {
        LOGW("LoRaWANTx", "Payload %d bytes exceeds max %d for DR%d", 
             payload.length(), maxPayload, currentDR);
        return false;
    }
    
    // Transmit
    uint8_t port = _config.communication.lorawan.defaultPort;
    bool confirmed = _config.communication.lorawan.useConfirmedUplinks;
    
    bool success = _service->sendData(
        port,
        (const uint8_t*)payload.c_str(),
        (uint8_t)payload.length(),
        confirmed
    );
    
    if (success) {
        LOGI("LoRaWANTx", "Transmitted %d bytes on port %d", payload.length(), port);
    } else {
        LOGW("LoRaWANTx", "Transmission failed");
    }
    
    return success;
}

bool LoRaWANTransmitter::validatePayload(const String& payload, uint8_t& maxPayload, uint8_t& currentDR) {
    if (!_hal) {
        LOGW("LoRaWANTx", "HAL not available, cannot validate payload size");
        return false;
    }
    
    maxPayload = _hal->getMaxPayloadSize();
    currentDR = _hal->getCurrentDataRate();
    
    if (payload.length() > maxPayload) {
        return false;
    }
    
    return true;
}

String LoRaWANTransmitter::formatReadings(const std::vector<SensorReading>& readings) {
    // Compact format: key:value,key:value,...
    String payload = "";
    for (size_t i = 0; i < readings.size(); ++i) {
        if (i > 0) payload += ",";
        payload += readings[i].type;
        payload += ":";
        if (isnan(readings[i].value)) {
            payload += "nan";
        } else {
            // Use integer for counters, float for others
            if (strcmp(readings[i].type, TelemetryKeys::PulseDelta) == 0 ||
                strcmp(readings[i].type, TelemetryKeys::BatteryPercent) == 0 ||
                strcmp(readings[i].type, TelemetryKeys::ErrorCount) == 0 ||
                strcmp(readings[i].type, TelemetryKeys::TimeSinceReset) == 0) {
                payload += String((int)readings[i].value);
            } else {
                payload += String(readings[i].value, 2);
            }
        }
    }
    return payload;
}

// ============================================================================
// YF-S201 Water Flow Sensor Implementation
// ============================================================================

class YFS201WaterFlowSensor : public ISensor {
public:
    YFS201WaterFlowSensor(uint8_t pin, bool enabled, IPersistenceHal* persistence, const char* persistence_namespace);
    ~YFS201WaterFlowSensor();

    void begin() override;
    void read(std::vector<SensorReading>& readings) override;
    const char* getName() const override { return "YFS201WaterFlow"; }

    // Public static method to check and clear the interrupt flag
    static bool getAndClearInterruptFlag() {
        if (_interruptFired) {
            _interruptFired = false;
            return true;
        }
        return false;
    }

    // Public method for external task to save the total volume
    void saveTotalVolume();
    
    // Public method to reset the volume counter
    void resetTotalVolume();

private:
    const uint8_t _pin;
    const bool _enabled;
    IPersistenceHal* _persistence;
    const char* _persistence_namespace;
    
    // Pulse counting
    static void IRAM_ATTR pulseCounter();
    static volatile uint32_t _pulseCount;
    static volatile bool _interruptFired;
    
    unsigned long _lastReadTimeMs = 0;
    uint32_t _totalPulses = 0;

    // YF-S201 constant: pulses per liter
    static constexpr float PULSES_PER_LITER = 450.0f;
};

// Define static members
volatile uint32_t YFS201WaterFlowSensor::_pulseCount = 0;
volatile bool YFS201WaterFlowSensor::_interruptFired = false;

YFS201WaterFlowSensor::YFS201WaterFlowSensor(uint8_t pin, bool enabled, IPersistenceHal* persistence, const char* persistence_namespace)
    : _pin(pin), _enabled(enabled), _persistence(persistence), _persistence_namespace(persistence_namespace) {
}

YFS201WaterFlowSensor::~YFS201WaterFlowSensor() {
    if (_enabled && _pin != 0) {
        detachInterrupt(digitalPinToInterrupt(_pin));
    }
}

void YFS201WaterFlowSensor::begin() {
    if (!_enabled) return;

    if (_persistence) {
        _persistence->begin(_persistence_namespace);
        _totalPulses = _persistence->loadU32("totalPulses");
        _persistence->end();
        LOGD(getName(), "Loaded total pulses: %u", _totalPulses);
    }

    pinMode(_pin, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(_pin), pulseCounter, FALLING);
    _lastReadTimeMs = millis();
}

void IRAM_ATTR YFS201WaterFlowSensor::pulseCounter() {
    _pulseCount++;
    _interruptFired = true;
}

void YFS201WaterFlowSensor::read(std::vector<SensorReading>& readings) {
    unsigned long currentTimeMs = millis();

    if (!_enabled) {
        readings.push_back({TelemetryKeys::PulseDelta, std::numeric_limits<float>::quiet_NaN(), currentTimeMs});
        readings.push_back({TelemetryKeys::TotalVolume, std::numeric_limits<float>::quiet_NaN(), currentTimeMs});
        return;
    }

    // Atomically get and reset the pulse count
    noInterrupts();
    unsigned long currentPulses = _pulseCount;
    _pulseCount = 0;
    interrupts();

    _lastReadTimeMs = currentTimeMs;

    // Report raw pulse delta
    readings.push_back({TelemetryKeys::PulseDelta, (float)currentPulses, currentTimeMs});

    // Report total volume
    _totalPulses += currentPulses;
    float totalVolumeLiters = (float)_totalPulses / PULSES_PER_LITER;
    readings.push_back({TelemetryKeys::TotalVolume, totalVolumeLiters, currentTimeMs});
    
    LOGD(getName(), "Read %u pulses", currentPulses);
}

void YFS201WaterFlowSensor::resetTotalVolume() {
    if (!_enabled) return;
    
    LOGI(getName(), "Resetting total volume. Old: %u pulses", _totalPulses);
    _totalPulses = 0;
    saveTotalVolume();
}

void YFS201WaterFlowSensor::saveTotalVolume() {
    if (!_enabled || !_persistence) return;
    
    _persistence->begin(_persistence_namespace);
    bool success = _persistence->saveU32("totalPulses", _totalPulses);
    _persistence->end();
    
    if (success) {
        LOGD(getName(), "Saved total pulses: %u", _totalPulses);
    } else {
        LOGW(getName(), "Failed to save total pulses");
    }
}

// ============================================================================
// Battery Monitor Sensor Implementation
// ============================================================================

class BatteryMonitorSensor : public ISensor {
public:
    BatteryMonitorSensor(IBatteryService* batteryService, bool enabled) 
      : _batteryService(batteryService), _enabled(enabled) {}

    void begin() override {}

    void read(std::vector<SensorReading>& readings) override {
        if (_enabled && _batteryService) {
            readings.push_back({TelemetryKeys::BatteryPercent, (float)_batteryService->getBatteryPercent(), millis()});
        } else {
            readings.push_back({TelemetryKeys::BatteryPercent, std::numeric_limits<float>::quiet_NaN(), millis()});
        }
    }

    const char* getName() const override { return "BatteryMonitor"; }

private:
    IBatteryService* _batteryService;
    const bool _enabled;
};

// ============================================================================
// SENSOR FACTORY
// ============================================================================

namespace SensorFactory {
    std::shared_ptr<YFS201WaterFlowSensor> createYFS201WaterFlowSensor(
        uint8_t pin, 
        bool enabled, 
        IPersistenceHal* persistence, 
        const char* persistence_namespace
    ) {
        return std::make_shared<YFS201WaterFlowSensor>(pin, enabled, persistence, persistence_namespace);
    }

    std::shared_ptr<ISensor> createBatteryMonitorSensor(IBatteryService* batteryService, bool enabled) {
        return std::make_shared<BatteryMonitorSensor>(batteryService, enabled);
    }
}

#endif // SENSOR_IMPLEMENTATIONS_HPP
