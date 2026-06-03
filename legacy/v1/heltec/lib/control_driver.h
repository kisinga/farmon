// Control driver abstraction for edge rules engine.
// Lib provides base drivers; integrations can implement IControlDriver for
// protocol-specific control (e.g. RS485 pump). Devices register drivers per control index.

#pragma once

#include <stdint.h>
#include <Arduino.h>
#include "core_logger.h"

// Interface for control execution (pump on/off, valve open/closed, etc.)
class IControlDriver {
public:
    virtual ~IControlDriver() = default;
    virtual bool setState(uint8_t state_idx) = 0;
};

// Log-only driver for testing or when hardware is not yet connected
class NoOpControlDriver : public IControlDriver {
public:
    explicit NoOpControlDriver(const char* label = "Control") : _label(label) {}
    bool setState(uint8_t state_idx) override {
        LOGI("Control", "%s -> state %u", _label, state_idx);
        return true;
    }
private:
    const char* _label;
};

// GPIO relay driver: state_idx 0 = LOW, non-zero = HIGH
class GpioRelayDriver : public IControlDriver {
public:
    explicit GpioRelayDriver(uint8_t pin) : _pin(pin), _initialized(false) {}
    void begin() {
        if (_pin != 255) {
            pinMode(_pin, OUTPUT);
            digitalWrite(_pin, LOW);
            _initialized = true;
        }
    }
    bool setState(uint8_t state_idx) override {
        if (!_initialized && _pin != 255) {
            begin();
        }
        if (_pin == 255) {
            LOGI("Control", "GpioRelay pin not set");
            return true;
        }
        digitalWrite(_pin, state_idx ? HIGH : LOW);
        LOGI("Control", "GPIO %u -> %s", _pin, state_idx ? "ON" : "OFF");
        return true;
    }
private:
    uint8_t _pin;
    bool _initialized;
};
