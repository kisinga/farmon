#include "comm_coordinator.h"
#include "core_logger.h"
#include <Arduino.h>

CommCoordinator::CommCoordinator(ILoRaWANHal& hal) : _hal(hal) {
    memset(_queue, 0, sizeof(_queue));
}

void CommCoordinator::setConfig(const LoRaWANConfig& cfg) {
    _config = cfg;
}

void CommCoordinator::begin() {
    _hal.setOnDataReceived([this](uint8_t port, const uint8_t* payload, uint8_t length) {
        onHalData(port, payload, length);
    });
    _hal.setOnTxDone([this]() { onHalTxDone(); });
    _hal.setOnTxTimeout([this]() { onHalTxTimeout(); });
    _hal.setOnTxNoAck([this]() { onHalTxNoAck(); });
}

void CommCoordinator::tick(uint32_t nowMs) {
    _hal.tick(nowMs);
    drainOne();

    // Reconnection event: transition from disconnected to joined
    bool isJoined = _hal.isJoined();
    if (isJoined && !_wasJoined && _disconnectedAtMs != 0) {
        uint32_t durationSec = (nowMs - _disconnectedAtMs) / 1000;
        if (durationSec > 86400 * 365) durationSec = 86400 * 365;
        uint8_t payload[4];
        payload[0] = (uint8_t)(durationSec & 0xff);
        payload[1] = (uint8_t)((durationSec >> 8) & 0xff);
        payload[2] = (uint8_t)((durationSec >> 16) & 0xff);
        payload[3] = (uint8_t)((durationSec >> 24) & 0xff);
        enqueue(FPORT_RECONNECTION, payload, 4, true);
        _disconnectedAtMs = 0;
    }
    if (!isJoined && _wasJoined) {
        _disconnectedAtMs = nowMs;
    }
    _wasJoined = isJoined;
}

bool CommCoordinator::enqueue(uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed) {
    if (len > TX_SLOT_SIZE) {
        LOGW("Comm", "Payload %d bytes exceeds slot size, dropping", len);
        return false;
    }
    if (_queueCount >= TX_QUEUE_SIZE) {
        // Drop oldest
        _queueHead = (_queueHead + 1) % TX_QUEUE_SIZE;
        _queueCount--;
        LOGW("Comm", "Tx queue full, dropping oldest");
    }
    TxSlot& slot = _queue[_queueTail];
    slot.port = port;
    slot.len = len;
    slot.confirmed = confirmed;
    memcpy(slot.payload, payload, len);
    _queueTail = (_queueTail + 1) % TX_QUEUE_SIZE;
    _queueCount++;
    return true;
}

void CommCoordinator::drainOne() {
    if (_queueCount == 0 || !_hal.isReadyForTx()) return;
    TxSlot& slot = _queue[_queueHead];
    bool ok = _hal.sendData(slot.port, slot.payload, slot.len, slot.confirmed);
    _queueHead = (_queueHead + 1) % TX_QUEUE_SIZE;
    _queueCount--;
    (void)ok;  // Callbacks handle success/failure
}

void CommCoordinator::requestJoin() {
    if (!_hal.isJoined() && !_hal.isJoinInProgress()) {
        _shouldJoin = true;
    }
}

void CommCoordinator::performJoin() {
    if (!_shouldJoin) return;
    _shouldJoin = false;
    _hal.join();
}

bool CommCoordinator::isJoined() const {
    return _hal.isJoined();
}

bool CommCoordinator::isConnected() const {
    if (!_hal.isJoined()) return false;
    if (_lastSuccessMs == 0) return true;  // Joined but no TX yet — treat as connected
    return (millis() - _lastSuccessMs) <= OFFLINE_THRESHOLD_MS;
}

bool CommCoordinator::isReadyForTx() const {
    return _hal.isReadyForTx();
}

void CommCoordinator::setOnDownlink(OnDataReceived cb) {
    _onDownlink = cb;
}

void CommCoordinator::setOnTxDone(OnTxDone cb) {
    _onTxDone = cb;
}

void CommCoordinator::setOnTxTimeout(OnTxTimeout cb) {
    _onTxTimeout = cb;
}

void CommCoordinator::setOnTxNoAck(OnTxNoAck cb) {
    _onTxNoAck = cb;
}

ILoRaWANHal::ConnectionState CommCoordinator::getConnectionState() const {
    return _hal.getConnectionState();
}

int16_t CommCoordinator::getLastRssi() const {
    return _hal.getLastRssiDbm();
}

int8_t CommCoordinator::getLastSnr() const {
    return _hal.getLastSnr();
}

uint32_t CommCoordinator::getUplinkCount() const {
    return _hal.getUplinkCount();
}

uint32_t CommCoordinator::getDownlinkCount() const {
    return _hal.getDownlinkCount();
}

uint8_t CommCoordinator::getMaxPayloadSize() const {
    return _hal.getMaxPayloadSize();
}

uint8_t CommCoordinator::getCurrentDataRate() const {
    return _hal.getCurrentDataRate();
}

void CommCoordinator::resetCounters() {
    _hal.resetCounters();
}

void CommCoordinator::onHalTxDone() {
    _lastSuccessMs = millis();
    _txFailActive = false;
    if (_onTxDone) _onTxDone();
}

void CommCoordinator::onHalTxTimeout() {
    _txFailActive = true;
    if (_onTxTimeout) _onTxTimeout();
}

void CommCoordinator::onHalTxNoAck() {
    _txFailActive = true;
    if (_onTxNoAck) _onTxNoAck();
}

void CommCoordinator::onHalData(uint8_t port, const uint8_t* payload, uint8_t length) {
    if (_onDownlink) _onDownlink(port, payload, length);
}
