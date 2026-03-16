// Inverter-pump integration: 3ph inverter over RS485 controlling a pump.
// Provides readings (pump state, errors, energy) and control (pump on/off).
// Reusable across devices; device supplies Config and IUartHal.
// Stub implementation: no real Modbus yet; fills contract for composition.

#ifndef INTEGRATIONS_INVERTER_PUMP_H
#define INTEGRATIONS_INVERTER_PUMP_H

#include "lib/sensor_interface.hpp"
#include "lib/control_driver.h"
#include "lib/hal_uart.h"
#include "lib/core_logger.h"
#include <limits>
#include <vector>

// Telemetry keys this integration produces (device must add these to schema if used)
namespace InverterPumpKeys {
    constexpr const char* PumpState = "ps";   // 0=off, 1=on
    constexpr const char* PumpError = "pe";   // error code
    constexpr const char* EnergyKwh = "kwh"; // energy (kWh)
}

class InverterPumpIntegration : public ISensor, public IControlDriver {
public:
    struct Config {
        uint8_t slave_addr = 1;
        int8_t de_pin = -1;   // -1 = not used
        int8_t re_pin = -1;
        bool enabled = true;
    };

    InverterPumpIntegration(const Config& cfg, IUartHal* uart)
        : _cfg(cfg), _uart(uart), _pumpState(0) {}

    // --- ISensor ---
    void begin() override {
        if (!_cfg.enabled || !_uart) return;
        LOGI("InverterPump", "begin addr=%u", _cfg.slave_addr);
    }

    void read(std::vector<SensorReading>& readings) override {
        uint32_t ts = millis();
        if (!_cfg.enabled) {
            readings.push_back({InverterPumpKeys::PumpState, std::numeric_limits<float>::quiet_NaN(), ts});
            readings.push_back({InverterPumpKeys::PumpError, std::numeric_limits<float>::quiet_NaN(), ts});
            readings.push_back({InverterPumpKeys::EnergyKwh, std::numeric_limits<float>::quiet_NaN(), ts});
            return;
        }
        // Stub: return last pump state and placeholder values (real impl would read Modbus)
        readings.push_back({InverterPumpKeys::PumpState, (float)_pumpState, ts});
        readings.push_back({InverterPumpKeys::PumpError, 0.0f, ts});
        readings.push_back({InverterPumpKeys::EnergyKwh, 0.0f, ts});
    }

    const char* getName() const override { return "InverterPump"; }

    // --- IControlDriver ---
    bool setState(uint8_t state_idx) override {
        if (!_cfg.enabled) {
            LOGI("InverterPump", "disabled, pump -> %s", state_idx ? "on" : "off");
            return true;
        }
        // Stub: log only (real impl would send Modbus write to inverter)
        _pumpState = state_idx ? 1 : 0;
        LOGI("InverterPump", "Pump -> %s (addr=%u)", state_idx ? "on" : "off", _cfg.slave_addr);
        return true;
    }

private:
    Config _cfg;
    IUartHal* _uart;
    uint8_t _pumpState;
};

#endif // INTEGRATIONS_INVERTER_PUMP_H
