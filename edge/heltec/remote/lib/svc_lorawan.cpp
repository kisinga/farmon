#include "svc_lorawan.h"
#include "core_logger.h"

// Static instance for callbacks
LoRaWANService* LoRaWANService::callbackInstance = nullptr;

LoRaWANService::LoRaWANService(ILoRaWANHal& hal) : lorawanHal(hal) {
    callbackInstance = this;

    // Set up HAL callbacks
    lorawanHal.setOnDataReceived(&LoRaWANService::staticOnDataReceived);
    lorawanHal.setOnTxDone(&LoRaWANService::staticOnTxDone);
    lorawanHal.setOnTxTimeout(&LoRaWANService::staticOnTxTimeout);

    LOGI("LoRaWAN", "Service initialized");
}

void LoRaWANService::update(uint32_t nowMs) {
    lorawanHal.tick(nowMs);
}

bool LoRaWANService::isConnected() const {
    return lorawanHal.isConnected();
}

ILoRaWANService::ConnectionState LoRaWANService::getConnectionState() const {
    return lorawanHal.getConnectionState();
}

int16_t LoRaWANService::getLastRssiDbm() const {
    return lorawanHal.getLastRssiDbm();
}

int8_t LoRaWANService::getLastSnr() const {
    return lorawanHal.getLastSnr();
}

bool LoRaWANService::sendData(uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed) {
    return lorawanHal.sendData(port, payload, len, confirmed);
}

size_t LoRaWANService::getPeerCount() const {
    // In LoRaWAN, we always have 1 peer (the gateway)
    return isConnected() ? 1 : 0;
}

size_t LoRaWANService::getTotalPeerCount() const {
    // In LoRaWAN, we always have 1 peer (the gateway)
    return 1;
}

bool LoRaWANService::isJoined() const {
    return lorawanHal.isJoined();
}

void LoRaWANService::join() {
    lorawanHal.join();
}

void LoRaWANService::forceReconnect() {
    lorawanHal.forceReconnect();
}

uint32_t LoRaWANService::getUplinkCount() const {
    return lorawanHal.getUplinkCount();
}

uint32_t LoRaWANService::getDownlinkCount() const {
    return lorawanHal.getDownlinkCount();
}

void LoRaWANService::resetCounters() {
    lorawanHal.resetCounters();
}

void LoRaWANService::setDefaultPort(uint8_t port) {
    defaultPort = port;
    LOGI("LoRaWAN", "Default port set to %d", port);
}

void LoRaWANService::setDefaultConfirmed(bool confirmed) {
    defaultConfirmed = confirmed;
    LOGI("LoRaWAN", "Default confirmed mode set to %s", confirmed ? "true" : "false");
}

// Private callback handlers
void LoRaWANService::onDataReceived(uint8_t port, const uint8_t* payload, uint8_t length) {
    LOGD("LoRaWAN", "Received %d bytes on port %d", length, port);

    // Handle commands if this is a downlink message
    if (length >= 1) {
        CommandType cmdType = (CommandType)payload[0];
        switch (cmdType) {
            case CommandType::ResetWaterVolume:
                LOGI("LoRaWAN", "Received ResetWaterVolume command");
                // Handle reset water volume command
                break;

            case CommandType::SetReportingInterval:
                if (length >= 5) {
                    uint32_t interval = (payload[1] << 24) | (payload[2] << 16) | (payload[3] << 8) | payload[4];
                    LOGI("LoRaWAN", "Set reporting interval to %u ms", interval);
                }
                break;

            case CommandType::GetDeviceStatus:
                LOGI("LoRaWAN", "Device status requested");
                // Send device status in response
                break;

            case CommandType::RebootDevice:
                LOGI("LoRaWAN", "Reboot command received");
                // Handle reboot command
                break;

            default:
                LOGW("LoRaWAN", "Unknown command type: %d", (uint8_t)cmdType);
                break;
        }
    }
}

void LoRaWANService::onTxDone() {
    LOGD("LoRaWAN", "Transmission completed successfully");
}

void LoRaWANService::onTxTimeout() {
    LOGW("LoRaWAN", "Transmission timeout");
}

// Static callback wrappers
void LoRaWANService::staticOnDataReceived(uint8_t port, const uint8_t* payload, uint8_t length) {
    if (callbackInstance) {
        callbackInstance->onDataReceived(port, payload, length);
    }
}

void LoRaWANService::staticOnTxDone() {
    if (callbackInstance) {
        callbackInstance->onTxDone();
    }
}

void LoRaWANService::staticOnTxTimeout() {
    if (callbackInstance) {
        callbackInstance->onTxTimeout();
    }
}
