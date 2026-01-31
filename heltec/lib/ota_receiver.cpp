#include "ota_receiver.h"
#include "protocol_constants.h"
#include "core_logger.h"
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
    if (!sendFn_) return;
    uint8_t buf[3];
    buf[0] = static_cast<uint8_t>(status);
    buf[1] = (uint8_t)(chunkIndex & 0xFF);
    buf[2] = (uint8_t)(chunkIndex >> 8);
    sendFn_(FPORT_OTA_PROGRESS, buf, 3);
    LOGI("OTA", "Progress: status=%d index=%u", (int)status, (unsigned)chunkIndex);
}

bool OtaReceiver::handleDownlink(uint8_t port, const uint8_t* payload, uint8_t length) {
    if (port == FPORT_OTA_START) {
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
        const uint8_t* chunkPayload = payload + OTA_INDEX_SIZE;
        uint16_t recvCrc = (uint16_t)payload[OTA_INDEX_SIZE + OTA_PAYLOAD_SIZE] |
                          ((uint16_t)payload[OTA_INDEX_SIZE + OTA_PAYLOAD_SIZE + 1] << 8);

        if (index < nextExpectedIndex_) {
            // Duplicate: no-op write, still ACK so server can advance
            sendProgress(ProgressStatus::ChunkOk, index);
            return true;
        }
        if (index > nextExpectedIndex_) {
            // Out of order: ignore (server will resend)
            return true;
        }

        if (!verifyChunkCrc16(chunkPayload, OTA_PAYLOAD_SIZE, recvCrc)) {
            LOGW("OTA", "Chunk %u CRC mismatch", (unsigned)index);
            return true;  // Don't send fPort 8; server will resend on timeout
        }

        // Update.write() takes non-const uint8_t*; copy payload into a buffer
        uint8_t buf[OTA_PAYLOAD_SIZE];
        memcpy(buf, chunkPayload, OTA_PAYLOAD_SIZE);
        size_t written = Update.write(buf, OTA_PAYLOAD_SIZE);
        if (written != OTA_PAYLOAD_SIZE) {
            LOGW("OTA", "Update.write failed: wrote %d", (int)written);
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
            if (hasExpectedCrc32_) {
                // Optional: verify full-image CRC32 (ESP32 Update may not expose it; skip for v1)
                (void)expectedCrc32_;
            }
            state_ = State::Verifying;
            sendProgress(ProgressStatus::Done, index);
            rebootAtMs_ = millis() + REBOOT_DELAY_MS;
            state_ = State::Rebooting;
            LOGI("OTA", "All chunks received, rebooting in %lu ms", (unsigned long)REBOOT_DELAY_MS);
        }
        return true;
    }

    if (port == FPORT_OTA_CANCEL) {
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
