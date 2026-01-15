// CommunicationLogger - Logger implementation that forwards messages through communication channels
// Provides logging interface that routes log messages to configured communication transports

#pragma once

#include "common_message_types.h"
#include <Arduino.h>
#include <stdarg.h>
#include <stdio.h>
#include "communication_manager.h"

class CommunicationLogger {
public:
    enum class Level : uint8_t {
        Error = 0,
        Warning = 1,
        Info = 2,
        Debug = 3,
        Verbose = 4
    };

    // Initialize with communication manager
    static void begin(CommunicationManager* commMgr, const char* deviceId = nullptr) {
        instance = new CommunicationLogger(commMgr, deviceId);
    }

    // Logging methods
    static void log(Level level, const char* tag, const char* format, ...) {
        if (!instance || !instance->commManager) return;

        va_list args;
        va_start(args, format);
        instance->logMessage(level, tag, format, args);
        va_end(args);
    }

    // Convenience methods
    static void error(const char* tag, const char* format, ...) {
        if (!instance) return;
        va_list args;
        va_start(args, format);
        instance->logMessage(Level::Error, tag, format, args);
        va_end(args);
    }

    static void warning(const char* tag, const char* format, ...) {
        if (!instance) return;
        va_list args;
        va_start(args, format);
        instance->logMessage(Level::Warning, tag, format, args);
        va_end(args);
    }

    static void info(const char* tag, const char* format, ...) {
        if (!instance) return;
        va_list args;
        va_start(args, format);
        instance->logMessage(Level::Info, tag, format, args);
        va_end(args);
    }

    static void debug(const char* tag, const char* format, ...) {
        if (!instance) return;
        va_list args;
        va_start(args, format);
        instance->logMessage(Level::Debug, tag, format, args);
        va_end(args);
    }

    static void verbose(const char* tag, const char* format, ...) {
        if (!instance) return;
        va_list args;
        va_start(args, format);
        instance->logMessage(Level::Verbose, tag, format, args);
        va_end(args);
    }

    // Control methods
    static void setLevel(Level level) { if (instance) instance->logLevel = level; }
    static Level getLevel() { return instance ? instance->logLevel : Level::Info; }
    static void setEnabled(bool enabled) { if (instance) instance->enabled = enabled; }
    static bool isEnabled() { return instance && instance->enabled; }

    // Check if specific level is enabled
    static bool isLevelEnabled(Level level) {
        return instance && instance->enabled && static_cast<uint8_t>(level) <= static_cast<uint8_t>(instance->logLevel);
    }

private:
    CommunicationLogger(CommunicationManager* commMgr, const char* devId)
        : commManager(commMgr), deviceId(devId ? devId : "unknown"),
          logLevel(Level::Info), enabled(true) {}

    void logMessage(Level level, const char* tag, const char* format, va_list args) {
        if (!enabled || !commManager || static_cast<uint8_t>(level) > static_cast<uint8_t>(logLevel)) {
            return;
        }

        // Format the log message
        char buffer[256];
        int len = snprintf(buffer, sizeof(buffer), "[%s] %s: ", tag, getLevelString(level));

        if (len > 0 && len < sizeof(buffer)) {
            vsnprintf(buffer + len, sizeof(buffer) - len, format, args);
        }

        // Create message and route it
        Messaging::Message::Type msgType;
        switch (level) {
            case Level::Error: msgType = Messaging::Message::Type::Debug; break; // Map to debug for now
            case Level::Warning: msgType = Messaging::Message::Type::Debug; break;
            case Level::Info: msgType = Messaging::Message::Type::Debug; break;
            case Level::Debug: msgType = Messaging::Message::Type::Debug; break;
            case Level::Verbose: msgType = Messaging::Message::Type::Debug; break;
            default: msgType = Messaging::Message::Type::Debug; break;
        }

        Messaging::Message message(msgType, 0, 0xFF, false, reinterpret_cast<const uint8_t*>(buffer), strlen(buffer));
        commManager->routeMessage(message, nullptr); // No source transport for logger
    }

    const char* getLevelString(Level level) const {
        switch (level) {
            case Level::Error: return "ERROR";
            case Level::Warning: return "WARN";
            case Level::Info: return "INFO";
            case Level::Debug: return "DEBUG";
            case Level::Verbose: return "VERBOSE";
            default: return "UNKNOWN";
        }
    }

    CommunicationManager* commManager;
    const char* deviceId;
    Level logLevel;
    bool enabled;

    static CommunicationLogger* instance;
};

// Initialize static instance
CommunicationLogger* CommunicationLogger::instance = nullptr;

// Convenience macros for logging (similar to Android logging)
#define LOGE(tag, ...) CommunicationLogger::error(tag, __VA_ARGS__)
#define LOGW(tag, ...) CommunicationLogger::warning(tag, __VA_ARGS__)
#define LOGI(tag, ...) CommunicationLogger::info(tag, __VA_ARGS__)
#define LOGD(tag, ...) CommunicationLogger::debug(tag, __VA_ARGS__)
#define LOGV(tag, ...) CommunicationLogger::verbose(tag, __VA_ARGS__)

// Conditional logging macros
#define LOGE_IF(condition, tag, ...) if (condition) LOGE(tag, __VA_ARGS__)
#define LOGW_IF(condition, tag, ...) if (condition) LOGW(tag, __VA_ARGS__)
#define LOGI_IF(condition, tag, ...) if (condition) LOGI(tag, __VA_ARGS__)
#define LOGD_IF(condition, tag, ...) if (condition) LOGD(tag, __VA_ARGS__)
#define LOGV_IF(condition, tag, ...) if (condition) LOGV(tag, __VA_ARGS__)

// Periodic logging macros
#define LOGE_EVERY_MS(ms, ...) { static uint32_t lastLog = 0; uint32_t now = millis(); if (now - lastLog >= ms) { lastLog = now; LOGE(__VA_ARGS__); } }
#define LOGW_EVERY_MS(ms, ...) { static uint32_t lastLog = 0; uint32_t now = millis(); if (now - lastLog >= ms) { lastLog = now; LOGW(__VA_ARGS__); } }
#define LOGI_EVERY_MS(ms, ...) { static uint32_t lastLog = 0; uint32_t now = millis(); if (now - lastLog >= ms) { lastLog = now; LOGI(__VA_ARGS__); } }
#define LOGD_EVERY_MS(ms, ...) { static uint32_t lastLog = 0; uint32_t now = millis(); if (now - lastLog >= ms) { lastLog = now; LOGD(__VA_ARGS__); } }
#define LOGV_EVERY_MS(ms, ...) { static uint32_t lastLog = 0; uint32_t now = millis(); if (now - lastLog >= ms) { lastLog = now; LOGV(__VA_ARGS__); } }
