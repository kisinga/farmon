#pragma once

// Heltec WiFi LoRa 32 V3 pin definitions
#define BATTERY_ADC_PIN 1
#define VBAT_CTRL 37
// Optional charger status input from STAT pin (open-drain on many charger ICs)
// If your board does not route STAT to the MCU, set to -1 to disable.
#define CHARGE_STATUS_PIN -1
// Polarity: typical charger STAT pins are active-low (LOW = charging)
#define CHARGE_STATUS_ACTIVE_LOW 1

// OLED wiring defaults for Heltec WiFi LoRa 32 (V3, ESP32-S3)
// Guarded so board core/library definitions win if present
#ifndef SDA_OLED
#define SDA_OLED 17
#endif
#ifndef SCL_OLED
#define SCL_OLED 18
#endif
#ifndef RST_OLED
#define RST_OLED 21
#endif
