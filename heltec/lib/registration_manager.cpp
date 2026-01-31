#include "registration_manager.h"
#include "core_logger.h"
#include <Arduino.h>

void RegistrationManager::setDeviceInfo(const char* deviceType, const char* fwVersion) {
    strncpy(_deviceType, deviceType ? deviceType : "water_monitor", sizeof(_deviceType) - 1);
    _deviceType[sizeof(_deviceType) - 1] = '\0';
    strncpy(_fwVersion, fwVersion ? fwVersion : "2.0.0", sizeof(_fwVersion) - 1);
    _fwVersion[sizeof(_fwVersion) - 1] = '\0';
}

void RegistrationManager::onJoin() {
    if (_state == State::NotStarted) {
        _state = State::Pending;
    }
}

void RegistrationManager::onRegAck() {
    if (_state != State::Sent) return;
    _state = State::Complete;
    _lastSendMs = 0;
    if (_persistence) {
        _persistence->begin("reg_state");
        _persistence->saveU32("magic", REG_MAGIC);
        _persistence->saveU32("regVersion", CURRENT_REG_VERSION);
        _persistence->saveU32("registered", 1);
        _persistence->end();
    }
}

void RegistrationManager::forceReregister() {
    _state = State::Pending;
    _lastSendMs = 0;
}

void RegistrationManager::restoreFromPersistence() {
    if (!_persistence) return;
    _persistence->begin("reg_state");
    uint32_t magic = _persistence->loadU32("magic", 0);
    uint32_t regVersion = _persistence->loadU32("regVersion", 0);
    bool registered = _persistence->loadU32("registered", 0) == 1;
    _persistence->end();
    if (magic == REG_MAGIC && regVersion == CURRENT_REG_VERSION && registered) {
        _state = State::Complete;
    }
}

void RegistrationManager::tick(uint32_t nowMs) {
    if (_state == State::Pending) {
        send();
        return;
    }
    if (_state == State::Sent && _lastSendMs != 0 && (nowMs - _lastSendMs) >= REG_RETRY_INTERVAL_MS) {
        _lastSendMs = nowMs;
        _state = State::Pending;
        LOGI("Reg", "Retrying registration (awaiting ACK)");
        send();
    }
}

void RegistrationManager::send() {
    if (_state != State::Pending || !_enqueueFn) return;
    _state = State::Sent;
    _lastSendMs = millis();

    sendFrame("header", "v=1|sv=%d|type=%s|fw=%s", _schema.version, _deviceType, _fwVersion);

    auto appendItem = [](char* buf, int& pos, size_t bufSize, bool& isFirst, const char* item) -> bool {
        if (!isFirst) {
            int n = snprintf(buf + pos, bufSize - pos, ",");
            if (n < 0 || n >= (int)(bufSize - pos)) return false;
            pos += n;
        }
        isFirst = false;
        int n = snprintf(buf + pos, bufSize - pos, "%s", item);
        if (n < 0 || n >= (int)(bufSize - pos)) return false;
        pos += n;
        return true;
    };

    char fieldsBuf[200] = {0};
    char sysBuf[300] = {0};
    char statesBuf[200] = {0};
    int fieldsPos = snprintf(fieldsBuf, sizeof(fieldsBuf), "fields=");
    int sysPos = snprintf(sysBuf, sizeof(sysBuf), "sys=");
    int statesPos = snprintf(statesBuf, sizeof(statesBuf), "states=");
    bool fieldsFirst = true, sysFirst = true, statesFirst = true;
    char itemBuf[64];

    for (uint8_t i = 0; i < _schema.field_count; i++) {
        const auto& field = _schema.fields[i];
        int written = field.formatForRegistration(itemBuf, sizeof(itemBuf));
        if (written <= 0 || written >= (int)sizeof(itemBuf)) continue;
        itemBuf[sizeof(itemBuf) - 1] = '\0';
        switch (field.category) {
            case MessageSchema::FieldCategory::TELEMETRY:
                appendItem(fieldsBuf, fieldsPos, sizeof(fieldsBuf), fieldsFirst, itemBuf);
                break;
            case MessageSchema::FieldCategory::SYSTEM:
                appendItem(sysBuf, sysPos, sizeof(sysBuf), sysFirst, itemBuf);
                break;
            default:
                break;
        }
    }

    for (uint8_t i = 0; i < _schema.control_count; i++) {
        int written = _schema.controls[i].formatForRegistration(itemBuf, sizeof(itemBuf));
        if (written > 0) appendItem(statesBuf, statesPos, sizeof(statesBuf), statesFirst, itemBuf);
    }

    sendFrame("fields", "%s", fieldsBuf);
    sendFrame("sys", "%s", sysBuf);
    sendFrame("states", "%s", statesBuf);
    sendFrame("cmds", "cmds=reset:10,interval:11,reboot:12,clearerr:13,forcereg:14,status:15,ctrl:20,rule:30");
}

void RegistrationManager::sendFrame(const char* key, const char* format, ...) {
    static char buffer[256];
    int prefixLen = snprintf(buffer, sizeof(buffer), "reg:%s|", key);
    if (prefixLen < 0 || prefixLen >= (int)sizeof(buffer)) return;

    va_list args;
    va_start(args, format);
    int dataLen = vsnprintf(buffer + prefixLen, sizeof(buffer) - prefixLen, format, args);
    va_end(args);
    if (dataLen < 0) return;

    int totalLen = prefixLen + dataLen;
    if (totalLen > 222) return;

    _enqueueFn(FPORT_REGISTRATION, (const uint8_t*)buffer, totalLen, false);
}
