#pragma once

#include "hal_lorawan.h"
#include "communication_config.h"
#include "protocol_constants.h"
#include <stdint.h>
#include <stddef.h>
#include <functional>
#include <cstring>

/**
 * CommCoordinator — single entry point for LoRaWAN communication (Class C).
 *
 * Owns: connection state, uplink queue, HAL callback wiring, reconnection events.
 * All uplinks go through enqueue(). tick() drains one frame per call when idle.
 * Join: requestJoin() from task; performJoin() from run() (blocking).
 */
class CommCoordinator {
public:
    using OnDataReceived = ILoRaWANHal::OnDataReceived;
    using OnTxDone = ILoRaWANHal::OnTxDone;
    using OnTxTimeout = ILoRaWANHal::OnTxTimeout;
    using OnTxNoAck = ILoRaWANHal::OnTxNoAck;

    explicit CommCoordinator(ILoRaWANHal& hal);
    ~CommCoordinator() = default;

    void setConfig(const LoRaWANConfig& cfg);

    /** Wire HAL callbacks; call once after setOnDownlink/setOnTxDone/etc. */
    void begin();

    /** Single tick entry point — call from lorawan task only. */
    void tick(uint32_t nowMs);

    /** Enqueue uplink; returns false if queue full (drops oldest). */
    bool enqueue(uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed);

    void requestJoin();
    bool shouldJoin() const { return _shouldJoin; }
    void performJoin();

    bool isJoined() const;
    bool isConnected() const;   // joined + recent success
    bool isReadyForTx() const;

    void setOnDownlink(OnDataReceived cb);
    void setOnTxDone(OnTxDone cb);
    void setOnTxTimeout(OnTxTimeout cb);
    void setOnTxNoAck(OnTxNoAck cb);

    // Status for UI
    ILoRaWANHal::ConnectionState getConnectionState() const;
    int16_t getLastRssi() const;
    int8_t getLastSnr() const;
    uint32_t getUplinkCount() const;
    uint32_t getDownlinkCount() const;
    uint8_t getMaxPayloadSize() const;
    uint8_t getCurrentDataRate() const;
    void resetCounters();

    // TX fail state (for UI icon)
    bool getTxFailActive() const { return _txFailActive; }

private:
    static constexpr size_t TX_QUEUE_SIZE = 8;
    static constexpr size_t TX_SLOT_SIZE = 256;
    static constexpr uint32_t OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

    struct TxSlot {
        uint8_t port;
        uint8_t len;
        bool confirmed;
        uint8_t payload[TX_SLOT_SIZE];
    };

    ILoRaWANHal& _hal;
    LoRaWANConfig _config;
    OnDataReceived _onDownlink;
    OnTxDone _onTxDone;
    OnTxTimeout _onTxTimeout;
    OnTxNoAck _onTxNoAck;

    TxSlot _queue[TX_QUEUE_SIZE];
    size_t _queueHead = 0;
    size_t _queueTail = 0;
    size_t _queueCount = 0;

    bool _shouldJoin = false;
    uint32_t _lastSuccessMs = 0;
    uint32_t _disconnectedAtMs = 0;
    bool _wasJoined = false;
    bool _txFailActive = false;

    void drainOne();
    void onHalTxDone();
    void onHalTxTimeout();
    void onHalTxNoAck();
    void onHalData(uint8_t port, const uint8_t* payload, uint8_t length);
};
