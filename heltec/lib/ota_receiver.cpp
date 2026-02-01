#include "ota_receiver.h"
#include "protocol_constants.h"
#include "core_logger.h"
#include "lorawan_messages.h"
#include <Arduino.h>
#include <Update.h>
#include <cstring>

namespace OtaReceiver {

// CRC-16-CCITT (poly 0x1021, init 0xFFFF) over payload only — must match Node-RED
uint16_t OtaReceiver::crc16Payload(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int k = 0; k < 8; k++) {
            if (crc & 0x8000)
                crc = (crc << 1) ^ 0x1021;
            else
                crc = crc << 1;
        }
    }
    return crc;
}

bool OtaReceiver::verifyChunkCrc16(const uint8_t* payload, size_t payloadLen, uint16_t expectedCrc16) {
    return payloadLen >= OTA_PAYLOAD_SIZE && crc16Payload(payload, OTA_PAYLOAD_SIZE) == expectedCrc16;
}

void OtaReceiver::sendProgress(ProgressStatus status, uint16_t chunkIndex) {
    if (!txQueue_) return;
    
    LoRaWANTxMsg msg;
    msg.port = FPORT_OTA_PROGRESS;
    msg.len = 3;
    msg.confirmed = false;
    msg.payload[0] = static_cast<uint8_t>(status);
    msg.payload[1] = (uint8_t)(chunkIndex & 0xFF);
    msg.payload[2] = (uint8_t)(chunkIndex >> 8);
    
    xQueueSend(txQueue_, &msg, 0);  // Fire and forget
    LOGI("OTA", "Progress: status=%d index=%u", (int)status, (unsigned)chunkIndex);
}

bool OtaReceiver::handleDownlink(uint8_t port, const uint8_t* payload, uint8_t length) {
    if (port == FPORT_OTA_START) {
        LOGI("OTA", "RX fPort 40 Start len=%d", length);
        if (state_ != State::Idle) {
            LOGW("OTA", "Start ignored: already in state %d", (int)state_);
            return true;
        }
        if (length < OTA_START_MIN_LEN) {
            LOGW("OTA", "Start ignored: payload too short %d", length);
            return true;
        }
        totalSize_ = (uint32_t)payload[0] | ((uint32_t)payload[1] << 8) |
                     ((uint32_t)payload[2] << 16) | ((uint32_t)payload[3] << 24);
        totalChunks_ = (uint16_t)payload[4] | ((uint16_t)payload[5] << 8);
        expectedCrc32_ = 0;
        hasExpectedCrc32_ = false;
        if (length >= 10) {
            hasExpectedCrc32_ = true;
            expectedCrc32_ = (uint32_t)payload[6] | ((uint32_t)payload[7] << 8) |
                             ((uint32_t)payload[8] << 16) | ((uint32_t)payload[9] << 24);
        }
        if (totalChunks_ == 0 || totalSize_ == 0) {
            LOGW("OTA", "Start ignored: invalid size=%lu chunks=%u", (unsigned long)totalSize_, (unsigned)totalChunks_);
            return true;
        }
        if (!Update.begin(totalSize_, U_FLASH)) {
            LOGW("OTA", "Update.begin failed");
            sendProgress(ProgressStatus::Failed, 0);
            return true;
        }
        nextExpectedIndex_ = 0;
        state_ = State::Receiving;
        sendProgress(ProgressStatus::Ready, 0);
        LOGI("OTA", "Start: size=%lu chunks=%u", (unsigned long)totalSize_, (unsigned)totalChunks_);
        return true;
    }

    if (port == FPORT_OTA_CHUNK) {
        if (state_ != State::Receiving) {
            LOGW("OTA", "Chunk ignored: state=%d", (int)state_);
            return (state_ != State::Idle && state_ != State::Failed && state_ != State::Cancelled);
        }
        if (length != OTA_CHUNK_PAYLOAD_LEN) {
            LOGW("OTA", "Chunk ignored: bad length %d", length);
            return true;
        }
        uint16_t index = (uint16_t)payload[0] | ((uint16_t)payload[1] << 8);
        LOGI("OTA", "RX fPort 41 Chunk idx=%u len=%d", (unsigned)index, length);
        const uint8_t* chunkPayload = payload + OTA_INDEX_SIZE;
        uint16_t recvCrc = (uint16_t)payload[OTA_INDEX_SIZE + OTA_PAYLOAD_SIZE] |
                          ((uint16_t)payload[OTA_INDEX_SIZE + OTA_PAYLOAD_SIZE + 1] << 8);

        if (index >= totalChunks_) {
            LOGW("OTA", "Chunk %u out of range (total %u)", (unsigned)index, (unsigned)totalChunks_);
            return true;
        }
        if (!verifyChunkCrc16(chunkPayload, OTA_PAYLOAD_SIZE, recvCrc)) {
            LOGW("OTA", "Chunk %u CRC mismatch", (unsigned)index);
            sendProgress(ProgressStatus::Failed, index);
            return true;
        }
        if (index < nextExpectedIndex_) {
            sendProgress(ProgressStatus::ChunkOk, index);
            return true;
        }
        if (index > nextExpectedIndex_) {
            sendProgress(ProgressStatus::Failed, nextExpectedIndex_);
            return true;
        }

        // Diagnostic logging every 100 chunks to track memory
        if (index % 100 == 0 || index == 2064) {
            LOGI("OTA", "Chunk %u: heap=%lu min_heap=%lu",
                 (unsigned)index,
                 (unsigned long)ESP.getFreeHeap(),
                 (unsigned long)ESP.getMinFreeHeap());
        }

        // ZERO COPY: Cast away const (Update.write doesn't accept const but won't modify)
        size_t written = Update.write(const_cast<uint8_t*>(chunkPayload), OTA_PAYLOAD_SIZE);
        if (written != OTA_PAYLOAD_SIZE) {
            uint8_t err = Update.getError();
            LOGW("OTA", "Update.write failed at chunk %u: wrote %d, error=%u, hasError=%d, heap=%lu",
                 (unsigned)index, (int)written, err, Update.hasError(),
                 (unsigned long)ESP.getFreeHeap());
            Update.abort();
            state_ = State::Failed;
            sendProgress(ProgressStatus::Failed, index);
            return true;
        }
        nextExpectedIndex_++;
        sendProgress(ProgressStatus::ChunkOk, index);

        if (nextExpectedIndex_ >= totalChunks_) {
            bool ok = Update.end(true);
            if (!ok) {
                LOGW("OTA", "Update.end failed");
                state_ = State::Failed;
                sendProgress(ProgressStatus::Failed, index);
                return true;
            }
            if (hasExpectedCrc32_)
                (void)expectedCrc32_;
            state_ = State::Verifying;
            sendProgress(ProgressStatus::Done, index);
            rebootAtMs_ = millis() + REBOOT_DELAY_MS;
            state_ = State::Rebooting;
            LOGI("OTA", "All chunks received, rebooting in %lu ms", (unsigned long)REBOOT_DELAY_MS);
        }
        return true;
    }

    if (port == FPORT_OTA_CANCEL) {
        LOGI("OTA", "RX fPort 42 Cancel");
        if (state_ == State::Idle || state_ == State::Failed || state_ == State::Cancelled) {
            return (state_ != State::Idle);
        }
        if (state_ == State::Receiving || state_ == State::Verifying)
            Update.abort();
        state_ = State::Cancelled;
        sendProgress(ProgressStatus::Cancelled, nextExpectedIndex_);
        LOGI("OTA", "Cancelled");
        return true;
    }

    return false;
}

bool OtaReceiver::isActive() const {
    return state_ == State::Receiving || state_ == State::Verifying || state_ == State::Rebooting;
}

uint8_t OtaReceiver::getProgressPercent() const {
    if (totalChunks_ == 0) return 0;
    if (state_ == State::Verifying || state_ == State::Rebooting) return 100;
    return (uint8_t)((nextExpectedIndex_ * 100) / totalChunks_);
}

void OtaReceiver::tick(uint32_t nowMs) {
    if (state_ == State::Rebooting && rebootAtMs_ != 0 && nowMs >= rebootAtMs_) {
        LOGI("OTA", "Rebooting...");
        ESP.restart();
    }
}

} // namespace OtaReceiver
