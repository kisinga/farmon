#pragma once

#include <stdint.h>
#include <stddef.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// =============================================================================
// OTA over LoRaWAN — sequential chunk receiver
// =============================================================================
// fPort 40 = start, 41 = chunk, 42 = cancel; uplink progress on fPort 8.
// One chunk per ACK: device ACKs every chunk; server sends next.
// =============================================================================

namespace OtaReceiver {

// Progress status values (fPort 8 uplink)
enum class ProgressStatus : uint8_t {
    Ready     = 0,
    ChunkOk   = 1,
    Done      = 2,
    Failed    = 3,
    Cancelled = 4
};

// State machine
enum class State : uint8_t {
    Idle,
    Receiving,
    Verifying,
    Rebooting,
    Failed,
    Cancelled
};

// Chunk format constants (fPort 41)
constexpr size_t OTA_PAYLOAD_SIZE   = 218;  // bytes per chunk
constexpr size_t OTA_INDEX_SIZE     = 2;    // little-endian
constexpr size_t OTA_CRC16_SIZE     = 2;
constexpr size_t OTA_CHUNK_PAYLOAD_LEN = OTA_INDEX_SIZE + OTA_PAYLOAD_SIZE + OTA_CRC16_SIZE;  // 222

// fPort 40: minimum = 4 (size) + 2 (chunks) = 6; optional +4 = CRC32
constexpr size_t OTA_START_MIN_LEN = 6;
constexpr size_t OTA_START_MAX_LEN = 10;

class OtaReceiver {
public:
    OtaReceiver() = default;
    
    /** Constructor with TX queue (direct queue access, no callback) */
    explicit OtaReceiver(QueueHandle_t txQueue) : txQueue_(txQueue) {}

    /** Set TX queue (alternative to constructor) */
    void setTxQueue(QueueHandle_t txQueue) { txQueue_ = txQueue; }

    /**
     * Handle OTA downlink. Returns true if message was consumed (port 40, 41, 42).
     * When true, caller must not send command ACK; OTA uses fPort 8 for progress.
     */
    bool handleDownlink(uint8_t port, const uint8_t* payload, uint8_t length);

    /** True when state is Receiving, Verifying, or Rebooting. */
    bool isActive() const;

    State getState() const { return state_; }
    uint32_t getTotalSize() const { return totalSize_; }
    uint16_t getTotalChunks() const { return totalChunks_; }
    uint16_t getNextExpectedIndex() const { return nextExpectedIndex_; }
    /** 0..100 when receiving; 100 when done/verifying. */
    uint8_t getProgressPercent() const;

    /** Call periodically from main loop when state is Rebooting to perform ESP.restart(). */
    void tick(uint32_t nowMs);

private:
    void sendProgress(ProgressStatus status, uint16_t chunkIndex);
    bool verifyChunkCrc16(const uint8_t* payload, size_t payloadLen, uint16_t expectedCrc16);
    static uint16_t crc16Payload(const uint8_t* data, size_t len);

    QueueHandle_t txQueue_ = nullptr;
    State state_ = State::Idle;
    uint32_t totalSize_ = 0;
    uint16_t totalChunks_ = 0;
    uint32_t expectedCrc32_ = 0;       // 0 = not provided
    bool hasExpectedCrc32_ = false;
    uint16_t nextExpectedIndex_ = 0;
    uint32_t rebootAtMs_ = 0;
    static constexpr uint32_t REBOOT_DELAY_MS = 500;
};

} // namespace OtaReceiver
