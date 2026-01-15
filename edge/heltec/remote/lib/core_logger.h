// Header-only simple logger with verbosity, OLED overlay, and debug routing capabilities
// - Centralizes Serial and OLED logging
// - Supports temporary debug overlays with duration
// - Default: verbose=false; level=Info; Serial on

#pragma once

#include <Arduino.h>

namespace Logger {

enum class Level : uint8_t { Error = 0, Warn = 1, Info = 2, Debug = 3, Verbose = 4 };

struct OverlayCtx {
  char line1[22];
  char line2[22];
};

inline bool g_serialEnabled = true;
inline Level g_level = Level::Info;
inline bool g_verbose = false;
inline const char *g_deviceId = nullptr;
inline char g_deviceIdBuf[16] = {0};
inline OverlayCtx g_overlayCtx; // reused buffer

// Forward declarations to allow usage before definitions
inline void setLevel(Level level);
inline void setVerbose(bool verbose);

inline void begin(bool enableSerial, const char *deviceId) {
  g_serialEnabled = enableSerial;
  g_deviceId = deviceId;
}

// Internal initialization function - not exposed publicly to prevent unsafe usage
namespace internal {
inline void initializeUnsafe(const char *deviceId) {
  if (deviceId) {
    strncpy(g_deviceIdBuf, deviceId, sizeof(g_deviceIdBuf) - 1);
    g_deviceIdBuf[sizeof(g_deviceIdBuf) - 1] = '\0';
    begin(true, g_deviceIdBuf);
  } else {
    begin(true, nullptr);
  }
  setLevel(Level::Info);
  setVerbose(false);
}
}

// Safe initialization that prevents double initialization
// This is the ONLY public initialization method - follows safe DI pattern
// Returns true if initialization was performed, false if already initialized
inline bool safeInitialize(const char *deviceId) {
  // Check if already initialized by verifying deviceId is set
  if (g_deviceId != nullptr) {
    return false; // Already initialized
  }
  internal::initializeUnsafe(deviceId);
  return true;
}

inline void setLevel(Level level) { g_level = level; }
inline void setVerbose(bool verbose) { g_verbose = verbose; }

inline bool isEnabled(Level level) {
  if (g_verbose) return true;
  return static_cast<uint8_t>(level) <= static_cast<uint8_t>(g_level);
}

inline void vprintf(Level level, const char *tag, const char *fmt, va_list ap) {
  if (!isEnabled(level)) return;
  if (g_serialEnabled) {
    char buf[160];
    int len = vsnprintf(buf, sizeof(buf) - 1, fmt, ap);
    if (len >= 0 && len < (int)sizeof(buf) - 1) {
      buf[len] = '\0'; // Ensure null termination
    } else {
      buf[sizeof(buf) - 1] = '\0'; // Safety fallback
    }

    // Only print if Serial is available
    if (Serial) {
      Serial.print('[');
      if (tag) Serial.print(tag); else Serial.print(F("log"));
      Serial.print(']');
      if (g_deviceId) {
        Serial.print(' ');
        Serial.print(g_deviceId);
      }
      Serial.print(' ');
      Serial.println(buf);
    }
  }
}

inline void printf(Level level, const char *tag, const char *fmt, ...) {
  va_list ap; va_start(ap, fmt);
  vprintf(level, tag, fmt, ap);
  va_end(ap);
}

// Optional: unprefixed raw line output that still respects level and serial enable
inline void rawf(Level level, const char *fmt, ...) {
  if (!isEnabled(level) || !g_serialEnabled) return;
  char buf[160];
  va_list ap; va_start(ap, fmt);
  int len = vsnprintf(buf, sizeof(buf) - 1, fmt, ap);
  va_end(ap);
  if (len >= 0 && len < (int)sizeof(buf) - 1) {
    buf[len] = '\0'; // Ensure null termination
  } else {
    buf[sizeof(buf) - 1] = '\0'; // Safety fallback
  }

  // Only print if Serial is available
  if (Serial) {
    Serial.println(buf);
  }
}

} // namespace Logger

// Convenience logging macros for concise call sites
#ifndef LOGE
#define LOGE(tag, fmt, ...) Logger::printf(Logger::Level::Error,   tag, fmt, ##__VA_ARGS__)
#endif
#ifndef LOGW
#define LOGW(tag, fmt, ...) Logger::printf(Logger::Level::Warn,    tag, fmt, ##__VA_ARGS__)
#endif
#ifndef LOGI
#define LOGI(tag, fmt, ...) Logger::printf(Logger::Level::Info,    tag, fmt, ##__VA_ARGS__)
#endif
#ifndef LOGD
#define LOGD(tag, fmt, ...) Logger::printf(Logger::Level::Debug,   tag, fmt, ##__VA_ARGS__)
#endif
#ifndef LOGV
#define LOGV(tag, fmt, ...) Logger::printf(Logger::Level::Verbose, tag, fmt, ##__VA_ARGS__)
#endif

// Anti-spam helpers
#ifndef LOG_CONCAT_INNER
#define LOG_CONCAT_INNER(a,b) a##b
#endif
#ifndef LOG_CONCAT
#define LOG_CONCAT(a,b) LOG_CONCAT_INNER(a,b)
#endif
#ifndef LOG_UNIQUE_NAME
#define LOG_UNIQUE_NAME(base) LOG_CONCAT(base, __LINE__)
#endif

#ifndef LOG_EVERY_MS
#define LOG_EVERY_MS(intervalMs, code_block) \
  do { static uint32_t LOG_UNIQUE_NAME(_last__) = 0; uint32_t _now__ = millis(); \
       if (_now__ - LOG_UNIQUE_NAME(_last__) >= (uint32_t)(intervalMs)) { LOG_UNIQUE_NAME(_last__) = _now__; code_block; } } while(0)
#endif

#ifndef LOG_ON_CHANGE
#define LOG_ON_CHANGE(expr, code_block) \
  do { static auto LOG_UNIQUE_NAME(_prev__) = (expr); auto _cur__ = (expr); \
       if (_cur__ != LOG_UNIQUE_NAME(_prev__)) { LOG_UNIQUE_NAME(_prev__) = _cur__; code_block; } } while(0)
#endif


