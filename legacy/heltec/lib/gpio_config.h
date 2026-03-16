#pragma once

// =============================================================================
// Tasmota-lite: Runtime GPIO pin configuration
// =============================================================================
// Minimal prototype for experimenting with dynamic pin assignment.
// Pin changes are saved to NVS and take effect on reboot (same as Tasmota).
//
// Usage:
//   GpioConfig gpio(persistenceHal);
//   gpio.load();                          // load from NVS (or defaults)
//   gpio.init();                          // configure hardware from pin map
//   Pin(GpioFn::Relay, 0)                // find physical pin for first relay
//   gpio.handleDownlink(payload, len);    // fPort 35: remap pins
// =============================================================================

#include <Arduino.h>
#include "hal_persistence.h"
#include "core_logger.h"

// --- GPIO function enum (keep small, extend as needed) ---
enum class GpioFn : uint8_t {
    None        = 0,
    FlowSensor  = 1,   // pulse counter (interrupt, INPUT_PULLUP)
    Relay       = 2,   // digital output
    Button      = 3,   // digital input (INPUT_PULLUP)
    ADC         = 4,   // analog read
    I2C_SDA     = 5,
    I2C_SCL     = 6,
    OneWire     = 7,   // DS18B20
    UART_TX     = 8,
    UART_RX     = 9,
    LED         = 10,
    Counter     = 11,  // generic pulse counter
    _MAX
};

static const char* gpioFnName(GpioFn fn) {
    switch (fn) {
        case GpioFn::None:        return "None";
        case GpioFn::FlowSensor:  return "Flow";
        case GpioFn::Relay:       return "Relay";
        case GpioFn::Button:      return "Button";
        case GpioFn::ADC:         return "ADC";
        case GpioFn::I2C_SDA:     return "I2C_SDA";
        case GpioFn::I2C_SCL:     return "I2C_SCL";
        case GpioFn::OneWire:     return "1Wire";
        case GpioFn::UART_TX:     return "UART_TX";
        case GpioFn::UART_RX:     return "UART_RX";
        case GpioFn::LED:         return "LED";
        case GpioFn::Counter:     return "Counter";
        default:                  return "?";
    }
}

// --- Pin map constants ---
static constexpr uint8_t GPIO_MAX_PINS = 20;
static constexpr uint8_t GPIO_INVALID_PIN = 0xFF;

// --- Module presets (like Tasmota's built-in modules) ---
enum class GpioPreset : uint8_t {
    Generic     = 0,  // all None
    WaterMonitor = 1, // flow sensor + battery + relay + OLED
    SoilStation  = 2, // soil ADC + DS18B20 + relay + OLED
};

// --- The config ---
class GpioConfig {
public:
    static constexpr const char* NVS_NS = "gpio";
    static constexpr const char* NVS_KEY = "pinmap";
    static constexpr const char* NVS_PRESET = "preset";

    explicit GpioConfig(IPersistenceHal* persistence) : _persistence(persistence) {
        memset(_pinMap, 0, sizeof(_pinMap));
    }

    // Load pin map from NVS. Returns false if no saved config (uses defaults).
    bool load() {
        if (!_persistence) return false;
        _persistence->begin(NVS_NS);
        size_t loaded = _persistence->loadBytes(NVS_KEY, _pinMap, GPIO_MAX_PINS);
        _preset = static_cast<GpioPreset>(_persistence->loadU32(NVS_PRESET, 0));
        _persistence->end();

        if (loaded != GPIO_MAX_PINS) {
            applyPreset(GpioPreset::WaterMonitor);
            LOGI("GPIO", "No saved config, using WaterMonitor preset");
            return false;
        }
        LOGI("GPIO", "Loaded pin map from NVS");
        return true;
    }

    // Save current pin map to NVS.
    void save() {
        if (!_persistence) return;
        _persistence->begin(NVS_NS);
        _persistence->saveBytes(NVS_KEY, _pinMap, GPIO_MAX_PINS);
        _persistence->saveU32(NVS_PRESET, static_cast<uint32_t>(_preset));
        _persistence->end();
        LOGI("GPIO", "Pin map saved to NVS");
    }

    // Configure hardware from pin map. Call once at boot.
    void init() {
        for (uint8_t i = 0; i < GPIO_MAX_PINS; i++) {
            GpioFn fn = static_cast<GpioFn>(_pinMap[i]);
            if (fn == GpioFn::None) continue;

            uint8_t pin = _indexToPin(i);
            if (pin == GPIO_INVALID_PIN) continue;

            switch (fn) {
                case GpioFn::Relay:
                case GpioFn::LED:
                    pinMode(pin, OUTPUT);
                    digitalWrite(pin, LOW);
                    break;
                case GpioFn::Button:
                case GpioFn::FlowSensor:
                case GpioFn::Counter:
                    pinMode(pin, INPUT_PULLUP);
                    break;
                case GpioFn::ADC:
                    // ADC pins configured by sensor driver
                    break;
                case GpioFn::I2C_SDA:
                case GpioFn::I2C_SCL:
                    // I2C configured separately
                    break;
                default:
                    break;
            }
            LOGD("GPIO", "Pin %u (idx %u) -> %s", pin, i, gpioFnName(fn));
        }
        dump();
    }

    // --- Tasmota-style lookup functions ---

    // Find the physical GPIO pin assigned to a function.
    // index: 0 for first instance, 1 for second, etc. (e.g., Relay 0, Relay 1)
    uint8_t pin(GpioFn fn, uint8_t index = 0) const {
        uint8_t found = 0;
        for (uint8_t i = 0; i < GPIO_MAX_PINS; i++) {
            if (static_cast<GpioFn>(_pinMap[i]) == fn) {
                if (found == index) return _indexToPin(i);
                found++;
            }
        }
        return GPIO_INVALID_PIN;
    }

    // Check if a function is assigned to any pin.
    bool pinUsed(GpioFn fn) const {
        return pin(fn) != GPIO_INVALID_PIN;
    }

    // Count how many pins have a given function.
    uint8_t pinCount(GpioFn fn) const {
        uint8_t count = 0;
        for (uint8_t i = 0; i < GPIO_MAX_PINS; i++) {
            if (static_cast<GpioFn>(_pinMap[i]) == fn) count++;
        }
        return count;
    }

    // Set a pin's function by index. Does NOT take effect until reboot.
    void setPin(uint8_t pinIndex, GpioFn fn) {
        if (pinIndex < GPIO_MAX_PINS) {
            _pinMap[pinIndex] = static_cast<uint8_t>(fn);
        }
    }

    // Get function at pin index.
    GpioFn getPin(uint8_t pinIndex) const {
        if (pinIndex >= GPIO_MAX_PINS) return GpioFn::None;
        return static_cast<GpioFn>(_pinMap[pinIndex]);
    }

    // Apply a built-in preset.
    void applyPreset(GpioPreset preset) {
        memset(_pinMap, 0, sizeof(_pinMap));
        _preset = preset;

        switch (preset) {
            case GpioPreset::WaterMonitor:
                // Heltec V3 pin mapping
                _setPinByGpio(7,  GpioFn::FlowSensor);  // GPIO7  = flow sensor
                _setPinByGpio(1,  GpioFn::ADC);          // GPIO1  = battery ADC
                _setPinByGpio(17, GpioFn::I2C_SDA);      // GPIO17 = OLED SDA
                _setPinByGpio(18, GpioFn::I2C_SCL);      // GPIO18 = OLED SCL
                break;

            case GpioPreset::SoilStation:
                _setPinByGpio(1,  GpioFn::ADC);          // GPIO1  = soil moisture
                _setPinByGpio(2,  GpioFn::OneWire);      // GPIO2  = DS18B20
                _setPinByGpio(17, GpioFn::I2C_SDA);
                _setPinByGpio(18, GpioFn::I2C_SCL);
                break;

            case GpioPreset::Generic:
            default:
                break;
        }
    }

    // Handle fPort 35 downlink: pin remap commands.
    // Format A: [0x01, pin_idx, function, pin_idx, function, ...]  — set pins
    // Format B: [0x02, preset_id]                                   — apply preset
    // Format C: [0x03]                                              — dump config (reply via uplink)
    // Returns true if a reboot is needed.
    bool handleDownlink(const uint8_t* payload, uint8_t len) {
        if (len < 1) return false;

        switch (payload[0]) {
            case 0x01: {
                // Set individual pins
                for (uint8_t i = 1; i + 1 < len; i += 2) {
                    uint8_t idx = payload[i];
                    uint8_t fn = payload[i + 1];
                    if (idx < GPIO_MAX_PINS && fn < static_cast<uint8_t>(GpioFn::_MAX)) {
                        _pinMap[idx] = fn;
                        LOGI("GPIO", "Remap: idx %u -> %s", idx, gpioFnName(static_cast<GpioFn>(fn)));
                    }
                }
                save();
                return true; // reboot needed
            }
            case 0x02: {
                // Apply preset
                if (len >= 2) {
                    GpioPreset p = static_cast<GpioPreset>(payload[1]);
                    applyPreset(p);
                    save();
                    LOGI("GPIO", "Preset %u applied", payload[1]);
                    return true; // reboot needed
                }
                return false;
            }
            case 0x03: {
                dump();
                return false;
            }
        }
        return false;
    }

    // Print current pin map to serial.
    void dump() const {
        LOGI("GPIO", "--- Pin Map (preset %u) ---", static_cast<uint8_t>(_preset));
        for (uint8_t i = 0; i < GPIO_MAX_PINS; i++) {
            GpioFn fn = static_cast<GpioFn>(_pinMap[i]);
            if (fn != GpioFn::None) {
                LOGI("GPIO", "  [%2u] GPIO%u -> %s", i, _indexToPin(i), gpioFnName(fn));
            }
        }
    }

    const uint8_t* rawMap() const { return _pinMap; }

private:
    IPersistenceHal* _persistence;
    uint8_t _pinMap[GPIO_MAX_PINS];
    GpioPreset _preset = GpioPreset::Generic;

    // Map pin index (0..19) to physical GPIO number on Heltec V3.
    // Override this for a different board.
    static uint8_t _indexToPin(uint8_t index) {
        // Heltec V3 usable GPIOs (avoiding flash/radio/USB pins)
        static constexpr uint8_t map[] = {
            0, 1, 2, 3, 4, 5, 6, 7,         // GPIO 0-7
            17, 18, 21, 33, 34, 35, 36, 37,  // I2C, OLED_RST, misc
            38, 39, 40, 46                    // remaining usable
        };
        if (index < sizeof(map)) return map[index];
        return GPIO_INVALID_PIN;
    }

    // Find index for a given GPIO number and set its function.
    void _setPinByGpio(uint8_t gpio, GpioFn fn) {
        for (uint8_t i = 0; i < GPIO_MAX_PINS; i++) {
            if (_indexToPin(i) == gpio) {
                _pinMap[i] = static_cast<uint8_t>(fn);
                return;
            }
        }
    }
};
