#ifndef BATTERY_MONITOR_H
#define BATTERY_MONITOR_H

#include <Arduino.h>

namespace BatteryMonitor {

struct Config {
  // Set adcPin to 0xFF to disable reading (icon will still render outline)
  uint8_t adcPin = 0xFF;
  // Use calibrated mV read when available (ESP32-S2/S3/ESP32)
  bool useCalibratedMv = true;
  // Optional: set ADC attenuation once on first read (11dB recommended for VBAT via divider)
  bool setAttenuationOnFirstRead = false;
  // Input voltage divider ratio: Vbattery = Vadc * dividerRatio
  // Example: 100k:100k -> 2.0f; set to 1.0 if battery is directly sensed (not recommended)
  float dividerRatio = 2.00f;
  // Battery voltage curve bounds (for clamping only)
  float voltageEmpty = 3.30f;
  float voltageFull = 4.20f;
  // Number of ADC samples for smoothing (min 1). We will drop min/max when n>=4
  uint8_t samples = 8;
  // Optional: control pin that enables VBAT sense path (active LOW). -1 to disable.
  int8_t ctrlPin = -1;
  // Use Heltec V3 empirical scaling (raw/238.7) instead of calibrated mV + divider
  bool useHeltecV3Scaling = true;
  // Internal: one-time attenuation applied
  bool _attenuationApplied = false;
};

class BatteryMonitor {
public:
  explicit BatteryMonitor(const Config cfg) : _cfg(cfg) {
    _chargeState.pin = -1;
    _chargeState.activeLow = true;
    _chargeState.isChargingStable = false;
    _chargeState.lowStreak = 0;
    _chargeState.highStreak = 0;
    _chargeState.lastChangeMs = 0;
    _chargeGpioSawLow = false;
    _chargeGpioSawHigh = false;
    _chargeGpioReliable = false;
    _lastVBatMv = 0;
    _lastVBatMs = 0;
    _fallbackCharging = false;
    _chargingLatchedUntilMs = 0;
  }

  const Config& getConfig() const { return _cfg; }

  // Returns true and writes outPercent [0..100] when reading is available.
  // Returns false if adcPin is disabled or any error; caller may render outline-only.
  uint16_t readBatteryMilliVolts(bool &ok) {
    ok = false;
    if (_cfg.adcPin == 0xFF) return 0;
    
    // Optionally enable VBAT sense path via control pin
    if (_cfg.ctrlPin >= 0) {
      pinMode((uint8_t)_cfg.ctrlPin, OUTPUT);
      digitalWrite((uint8_t)_cfg.ctrlPin, LOW);
      delay(5);
    }

    // Collect samples (basic smoothing; drop min/max when we have enough)
    const uint8_t n = _cfg.samples < 1 ? 1 : _cfg.samples;
    uint32_t sum = 0;
    uint16_t vmin = 65535, vmax = 0;
    for (uint8_t i = 0; i < n; i++) {
      uint16_t sample = 0;
      if (_cfg.useHeltecV3Scaling) {
        // Read raw and defer scaling to the end (raw/238.7 -> Volts)
        int raw = analogRead(_cfg.adcPin);
        if (raw < 0) raw = 0;
        sample = (uint16_t)raw;
      } else if (_cfg.useCalibratedMv) {
        sample = (uint16_t)analogReadMilliVolts(_cfg.adcPin);
      } else {
        int raw = analogRead(_cfg.adcPin);
        if (raw < 0) raw = 0;
        sample = (uint16_t)((raw * 1100UL) / 4095UL);
      }
      sum += sample;
      if (sample < vmin) vmin = sample;
      if (sample > vmax) vmax = sample;
      delayMicroseconds(200);
    }

    uint32_t adjSum = sum;
    uint8_t adjN = n;
    if (n >= 4) {
      adjSum = sum - vmin - vmax;
      adjN = n - 2;
    }
    if (adjN == 0) adjN = 1;
    uint32_t vBatMv = 0;

    if (_cfg.useHeltecV3Scaling) {
      // Average raw and apply empirical scaling constant to get Volts
      const float rawAvg = (float)(adjSum / adjN);
      const float vBat = rawAvg / 238.7f; // Volts
      vBatMv = (uint32_t)(vBat * 1000.0f + 0.5f);
    } else {
      // One-time attenuation (best-effort; API varies across cores)
      if (_cfg.setAttenuationOnFirstRead && !_cfg._attenuationApplied) {
        #if defined(ESP32)
        ::analogSetPinAttenuation(_cfg.adcPin, ADC_11db);
        #endif
        _cfg._attenuationApplied = true;
      }
      const uint16_t vAdcMv = (uint16_t)(adjSum / adjN);
      vBatMv = (uint32_t)((float)vAdcMv * _cfg.dividerRatio + 0.5f);
    }

    // Return control pin to input to save power/leakage
    if (_cfg.ctrlPin >= 0) {
      pinMode((uint8_t)_cfg.ctrlPin, INPUT);
    }

    ok = true;
    return (uint16_t)(vBatMv > 65535 ? 65535 : vBatMv);
  }

  uint8_t mapVoltageToPercent(float vBat) {
    // Tuned curve based on measured discharge profile (ported from heltec_unofficial)
    static const float min_voltage = 3.04f;
    static const float max_voltage = 4.26f;
    static const uint8_t scaled_voltage[100] = {
      254, 242, 230, 227, 223, 219, 215, 213, 210, 207,
      206, 202, 202, 200, 200, 199, 198, 198, 196, 196,
      195, 195, 194, 192, 191, 188, 187, 185, 185, 185,
      183, 182, 180, 179, 178, 175, 175, 174, 172, 171,
      170, 169, 168, 166, 166, 165, 165, 164, 161, 161,
      159, 158, 158, 157, 156, 155, 151, 148, 147, 145,
      143, 142, 140, 140, 136, 132, 130, 130, 129, 126,
      125, 124, 121, 120, 118, 116, 115, 114, 112, 112,
      110, 110, 108, 106, 106, 104, 102, 101, 99, 97,
      94, 90, 81, 80, 76, 73, 66, 52, 32, 7,
    };
    // Compute threshold table step size
    const float step = (max_voltage - min_voltage) / 256.0f;
    for (int n = 0; n < 100; n++) {
      const float threshold = min_voltage + (step * (float)scaled_voltage[n]);
      if (vBat > threshold) {
        int p = 100 - n;
        if (p < 0) p = 0; if (p > 100) p = 100;
        return (uint8_t)p;
      }
    }
    return 0;
  }

  bool readPercent(uint8_t &outPercent) {
    bool ok = false;
    uint16_t vBatMv = readBatteryMilliVolts(ok);
    if (!ok) return false;
    float vBat = vBatMv / 1000.0f;
    // Clamp to configured bounds before mapping
    if (vBat < _cfg.voltageEmpty) vBat = _cfg.voltageEmpty;
    if (vBat > _cfg.voltageFull) vBat = _cfg.voltageFull;
    outPercent = mapVoltageToPercent(vBat);
    return true;
  }

  // Debounced charge detection state (assume active-low STAT: 0 = charging)
  struct ChargeDetectState {
    int8_t pin;
    bool activeLow;
    bool isChargingStable;
    uint8_t lowStreak;
    uint8_t highStreak;
    uint32_t lastChangeMs;
  };
  ChargeDetectState _chargeState;
  // Track GPIO reliability and a voltage-slope fallback detector
  bool _chargeGpioSawLow = false;
  bool _chargeGpioSawHigh = false;
  bool _chargeGpioReliable = false;
  uint16_t _lastVBatMv = 0;
  uint32_t _lastVBatMs = 0;
  bool _fallbackCharging = false;
  // Latch keeps UI bolt visible during CV/plateau
  uint32_t _chargingLatchedUntilMs = 0;

  void initChargeDetection(int8_t pin, bool activeLow, uint32_t nowMs) {
    _chargeState.pin = pin;
    _chargeState.activeLow = activeLow;
    if (_chargeState.pin >= 0) {
      pinMode((uint8_t)_chargeState.pin, INPUT);
      const int initLv = digitalRead((uint8_t)_chargeState.pin);
      _chargeState.isChargingStable = (_chargeState.activeLow ? (initLv == LOW) : (initLv == HIGH));
      _chargeState.lowStreak = _chargeState.isChargingStable ? 2 : 0;
      _chargeState.highStreak = _chargeState.isChargingStable ? 0 : 2;
      _chargeState.lastChangeMs = nowMs;
      // Treat GPIO as reliable immediately when configured; still debounce state changes
      _chargeGpioReliable = true;
    }
  }

  void updateChargeStatus(uint32_t nowMs) {
    bool ok = false;
    uint16_t vBatMv = readBatteryMilliVolts(ok);

    // Update slope-based fallback (grug: 1s check, simple thresholds, latch)
    if (ok) {
      if (_lastVBatMs == 0) {
        _lastVBatMs = nowMs;
        _lastVBatMv = vBatMv;
      } else {
        uint32_t dt = nowMs - _lastVBatMs;
        if (dt >= 1000) {
          const int32_t dv = (int32_t)vBatMv - (int32_t)_lastVBatMv;
          // Turn ON: any clear rise
          if (dv >= 3) {
            _fallbackCharging = true;
            _chargingLatchedUntilMs = nowMs + 120000UL; // 120s latch
          }
          // Turn OFF: only after latch and a definite drop
          if ((int32_t)(nowMs - _chargingLatchedUntilMs) > 0 && dv <= -10) {
            _fallbackCharging = false;
          }
          // While latch active, keep showing charging
          if ((int32_t)(nowMs - _chargingLatchedUntilMs) <= 0) {
            _fallbackCharging = true;
          }

          _lastVBatMs = nowMs;
          _lastVBatMv = vBatMv;
        }
      }
    }

    if (_chargeState.pin >= 0) {
      const int lv = digitalRead((uint8_t)_chargeState.pin);
      const bool chargingSample = (_chargeState.activeLow ? (lv == LOW) : (lv == HIGH));
      // Track level observations (diagnostic); reliability already enabled at init
      if (lv == LOW) _chargeGpioSawLow = true; else _chargeGpioSawHigh = true;
      // Simple debounce: require 2 consecutive samples to change state
      if (chargingSample) {
        _chargeState.lowStreak++;
        _chargeState.highStreak = 0;
      } else {
        _chargeState.highStreak++;
        _chargeState.lowStreak = 0;
      }
      if (!_chargeState.isChargingStable && _chargeState.lowStreak >= 2) {
        _chargeState.isChargingStable = true;
        _chargeState.lastChangeMs = nowMs;
      } else if (_chargeState.isChargingStable && _chargeState.highStreak >= 2) {
        _chargeState.isChargingStable = false;
        _chargeState.lastChangeMs = nowMs;
      }
    }
  }

  bool isCharging() const {
    const bool useGpio = _chargeGpioReliable;
    return useGpio ? _chargeState.isChargingStable : _fallbackCharging;
  }

private:
  Config _cfg;
};

} // namespace BatteryMonitor

#endif // BATTERY_MONITOR_H
