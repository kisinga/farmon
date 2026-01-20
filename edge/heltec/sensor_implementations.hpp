#ifndef SENSOR_IMPLEMENTATIONS_HPP
#define SENSOR_IMPLEMENTATIONS_HPP

#include <Arduino.h>
#include "sensor_interface.hpp"
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
// LoRaWAN Batch Transmitter Implementation
// ============================================================================

class LoRaWANBatchTransmitter : public SensorBatchTransmitter {
public:
    LoRaWANBatchTransmitter(ILoRaWANService* lorawanService, ILoRaWANHal* lorawanHal, const RemoteConfig& config);
    bool queueBatch(const std::vector<SensorReading>& readings) override;
    void update(uint32_t nowMs) override;
    bool isReady() const override;

private:
    String formatReadings(const std::vector<SensorReading>& readings);
    ILoRaWANService* _lorawanService;
    ILoRaWANHal* _lorawanHal;  // For accessing getMaxPayloadSize()
    const RemoteConfig& _config;
    std::vector<SensorReading> _readings;
    uint32_t _lastTxTimeMs = 0;
};

LoRaWANBatchTransmitter::LoRaWANBatchTransmitter(ILoRaWANService* lorawanService, ILoRaWANHal* lorawanHal, const RemoteConfig& config)
    : _lorawanService(lorawanService), _lorawanHal(lorawanHal), _config(config) {}

bool LoRaWANBatchTransmitter::queueBatch(const std::vector<SensorReading>& readings) {
    if (!_readings.empty()) {
        // Buffer has old data - replace it with newer data
        // This prevents stale data from blocking new transmissions
        LOGD("LoRaWANTx", "Buffer not empty, replacing with new batch (%u readings)", readings.size());
    }
    _readings = readings;
    return true;
}

void LoRaWANBatchTransmitter::update(uint32_t nowMs) {
    if (_readings.empty()) {
        return;
    }

    // Check if we're joined to the network
    if (!_lorawanService || !_lorawanService->isJoined()) {
        LOGD("LoRaWANTx", "Not joined, deferring transmission of %u readings", _readings.size());
        return;
    }
    
    LOGD("LoRaWANTx", "update() called: %u readings, lastTx: %u, now: %u", 
         _readings.size(), _lastTxTimeMs, nowMs);

    // Respect duty cycle / ready state
    // Note: LoRaWAN stack handles duty cycle internally, but we can add throttling
    uint32_t minInterval = _config.communication.lorawan.txIntervalMs;
    if (_lastTxTimeMs > 0) {
        uint32_t timeSinceLastTx = nowMs - _lastTxTimeMs;
        if (timeSinceLastTx < minInterval) {
            LOGD("LoRaWANTx", "TX throttled, %u ms remaining (lastTx: %u, now: %u)", 
                 minInterval - timeSinceLastTx, _lastTxTimeMs, nowMs);
            return;
        }
        // Throttle period has passed, proceed with transmission
        LOGD("LoRaWANTx", "Throttle period passed (%u ms since last TX), proceeding", timeSinceLastTx);
    }

    String payload = formatReadings(_readings);

    LOGD("LoRaWANTx", "Formatted %u readings: '%s'", _readings.size(), payload.c_str());

    if (payload.length() == 0) {
        LOGW("LoRaWANTx", "Failed to format readings");
        _readings.clear();
        return;
    }
    
    // Validate payload size against current data rate limit
    if (!_lorawanHal) {
        LOGW("LoRaWANTx", "HAL not available, cannot validate payload size");
        _readings.clear();
        return;
    }
    
    uint8_t maxPayload = _lorawanHal->getMaxPayloadSize();
    uint8_t currentDR = _lorawanHal->getCurrentDataRate();
    
    if (payload.length() > maxPayload) {
        LOGW("LoRaWANTx", "Payload %d bytes exceeds max %d for DR%d. Dropping.", 
             payload.length(), maxPayload, currentDR);
        _readings.clear();
        return;
    }
    
    LOGI("LoRaWANTx", "Attempting transmission: %d bytes (max %d for DR%d), lastTx: %u, now: %u", 
         payload.length(), maxPayload, currentDR, _lastTxTimeMs, nowMs);

    // Send via LoRaWAN service
    // Use default port from config, unconfirmed for telemetry
    uint8_t port = _config.communication.lorawan.defaultPort;
    bool confirmed = _config.communication.lorawan.useConfirmedUplinks;
    
    bool success = _lorawanService->sendData(
        port,
        (const uint8_t*)payload.c_str(),
        (uint8_t)payload.length(),
        confirmed
    );

    if (success) {
        LOGI("LoRaWANTx", "Transmission successful: %d bytes on port %d (nowMs: %u)", payload.length(), port, nowMs);
        _readings.clear();
        _lastTxTimeMs = nowMs;
    } else {
        LOGW("LoRaWANTx", "Transmission failed, clearing buffer to allow retry");
        // Clear buffer on failure to allow new batches
        // This prevents the "Buffer not empty" issue when transmission fails
        _readings.clear();
        // Don't update _lastTxTimeMs on failure - allow immediate retry
    }
}

bool LoRaWANBatchTransmitter::isReady() const {
    return _lorawanService != nullptr && _lorawanService->isJoined();
}

String LoRaWANBatchTransmitter::formatReadings(const std::vector<SensorReading>& readings) {
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
