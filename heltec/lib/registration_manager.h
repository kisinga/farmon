#pragma once

#include "message_schema.h"
#include "protocol_constants.h"
#include "hal_persistence.h"
#include <stdint.h>
#include <functional>
#include <cstdarg>
#include <cstdio>
#include <cstring>

/**
 * RegistrationManager — device registration state machine.
 *
 * States: NotStarted -> Pending -> Sent -> Complete
 * onJoin(): NotStarted -> Pending (triggers send)
 * send(): builds 5 frames, enqueues via enqueueFn (no delay)
 * onRegAck(): persist, Sent -> Complete
 * tick(): retry when Sent and elapsed > 30s
 */
class RegistrationManager {
public:
    enum class State : uint8_t {
        NotStarted,
        Pending,
        Sent,
        Complete
    };

    using EnqueueFn = std::function<bool(uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed)>;

    RegistrationManager() = default;

    void setEnqueueFn(EnqueueFn fn) { _enqueueFn = std::move(fn); }
    void setSchema(const MessageSchema::Schema& schema) { _schema = schema; }
    void setDeviceInfo(const char* deviceType, const char* fwVersion);
    void setPersistence(IPersistenceHal* hal) { _persistence = hal; }

    /** Called when device joins — NotStarted -> Pending. */
    void onJoin();

    /** Called when server sends reg ACK (port 5) — persist, Sent -> Complete. */
    void onRegAck();

    /** Force re-registration: clear persistence, set Pending (caller must have cleared NVS). */
    void forceReregister();

    /** Restore state from persistence (call at boot). */
    void restoreFromPersistence();

    /** Retry logic: Sent + 30s elapsed -> Pending, send again. */
    void tick(uint32_t nowMs);

    State getState() const { return _state; }

    /** Send all 5 registration frames via enqueueFn. Call when Pending. */
    void send();

private:
    static constexpr uint32_t REG_RETRY_INTERVAL_MS = 30000;

    EnqueueFn _enqueueFn;
    MessageSchema::Schema _schema;
    IPersistenceHal* _persistence = nullptr;
    char _deviceType[32] = "water_monitor";
    char _fwVersion[16] = "2.0.0";

    State _state = State::NotStarted;
    uint32_t _lastSendMs = 0;

    void sendFrame(const char* key, const char* format, ...);
};
