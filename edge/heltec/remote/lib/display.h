#ifndef OLEDDISPLAY_H
#define OLEDDISPLAY_H

// Header-only minimal OLED display manager for Heltec SSD1306
// - Optional: can be disabled at runtime
// - Supports a default homescreen renderer
// - Supports temporary per-task debug screens with timeout

#include <Arduino.h>
#include <Wire.h>
#include "HT_SSD1306Wire.h"
#include "logo.h"

#ifndef OLED_I2C_ADDR
#define OLED_I2C_ADDR 0x3C
#endif

// Forward declare Heltec power pin if available
#ifdef Vext
static inline void vextOn() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, LOW); // ON
}
static inline void vextOff() {
  pinMode(Vext, OUTPUT);
  digitalWrite(Vext, HIGH); // OFF
}
#else
static inline void vextOn() {}
static inline void vextOff() {}
#endif

// Render callback signature: device provides drawing logic
using RenderCallback = void (*)(SSD1306Wire &display, void *context);

class OledDisplay {
 public:
  OledDisplay()
      : display(OLED_I2C_ADDR, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED), initialized(false) {
  }

  explicit OledDisplay(uint8_t i2cAddress)
      : display(i2cAddress, 500000, SDA_OLED, SCL_OLED, GEOMETRY_128_64, RST_OLED), initialized(false) {
  }

  // Safe begin that prevents double initialization
  // Returns true if initialization was performed, false if already initialized
  bool safeBegin(bool enable) {
    if (initialized) {
      return false; // Already initialized
    }
    unsafeBegin(enable);
    return true;
  }

  // Public APIs used by services and application
  

 private:
  // Internal unsafe begin - should not be called directly
  void unsafeBegin(bool enable) {
    enabled = enable;
    if (!enabled) return;
    // Power on OLED rail
    if (vextPinOverride >= 0) {
      pinMode((uint8_t)vextPinOverride, OUTPUT);
      digitalWrite((uint8_t)vextPinOverride, LOW);
    } else {
      vextOn();
    }
    delay(100);

    // Hard reset the panel if RST is wired
#ifdef RST_OLED
    pinMode(RST_OLED, OUTPUT);
    digitalWrite(RST_OLED, LOW);
    delay(20);
    digitalWrite(RST_OLED, HIGH);
    delay(100);
#endif

    // Ensure I2C is up on the expected pins
    Wire.begin(SDA_OLED, SCL_OLED);

    display.init();
    display.setFont(ArialMT_Plain_10);
    display.setTextAlignment(TEXT_ALIGN_LEFT);

    initialized = true;
  }
  
  public:

  void setI2cClock(uint32_t hz) {
    Wire.setClock(hz);
  }

  // Optional: for boards where Vext macro is unavailable, provide the pin explicitly
  void setVextPinOverride(int8_t pin) { vextPinOverride = pin; }


  // Call periodically to update the display. Cheap if disabled.
  void tick(uint32_t nowMs) {
    if (!enabled) return;

    // This method is now a shell. The UIManager handles all drawing.
  }

  SSD1306Wire& getDisplay() { return display; }

  // Utilities to diagnose I2C screen presence. Call after begin().
  bool probeI2C(uint8_t addr) {
    if (!enabled) return false;
    Wire.beginTransmission(addr);
    uint8_t error = Wire.endTransmission();
    return (error == 0);
  }

  void i2cScan(Print &out) {
    if (!enabled) return;
    out.println(F("[i2c] scanning..."));
    uint8_t count = 0;
    for (uint8_t address = 1; address < 127; address++) {
      Wire.beginTransmission(address);
      uint8_t error = Wire.endTransmission();
      if (error == 0) {
        out.print(F("[i2c] found 0x"));
        if (address < 16) out.print('0');
        out.println(address, HEX);
        count++;
      }
      delay(2);
    }
    if (count == 0) {
      out.println(F("[i2c] no devices found"));
    }
  }

 private:
  bool enabled = false;
  bool initialized;
  
  int8_t vextPinOverride = -1; // -1 means use Vext macro if available
  
  SSD1306Wire display;
};

#endif // OLEDDISPLAY_H
