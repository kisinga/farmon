#pragma once

#include <stdint.h>
#include <functional>

class ILoRaWANHal {
public:
    enum class ConnectionState : uint8_t { Disconnected = 0, Connecting = 1, Connected = 2 };

    using OnDataReceived = std::function<void(uint8_t port, const uint8_t *payload, uint8_t length)>;
    using OnTxDone = std::function<void()>;
    using OnTxTimeout = std::function<void()>;

    virtual ~ILoRaWANHal() = default;

    // Initialization
    virtual bool begin(const uint8_t* devEui, const uint8_t* appEui, const uint8_t* appKey) = 0;
    virtual void tick(uint32_t nowMs) = 0;

    // Data transmission
    virtual bool sendData(uint8_t port, const uint8_t *payload, uint8_t length, bool confirmed = false) = 0;
    virtual bool isReadyForTx() const = 0;

    // Callbacks
    virtual void setOnDataReceived(OnDataReceived cb) = 0;
    virtual void setOnTxDone(OnTxDone cb) = 0;
    virtual void setOnTxTimeout(OnTxTimeout cb) = 0;

    // Status and configuration
    virtual bool isConnected() const = 0;
    virtual ConnectionState getConnectionState() const = 0;
    virtual int16_t getLastRssiDbm() const = 0;
    virtual int8_t getLastSnr() const = 0;

    // LoRaWAN specific
    virtual void setDeviceClass(uint8_t deviceClass) = 0;
    virtual void setDataRate(uint8_t dataRate) = 0;
    virtual void setTxPower(uint8_t txPower) = 0;
    virtual void setAdr(bool enable) = 0;
    
    // Data rate and payload size queries
    virtual uint8_t getCurrentDataRate() const = 0;
    virtual uint8_t getMaxPayloadSize() const = 0;

    // Join and session management
    virtual bool isJoined() const = 0;
    virtual bool isJoinInProgress() const = 0;
    virtual void join() = 0;
    virtual void forceReconnect() = 0;

    // Statistics
    virtual uint32_t getUplinkCount() const = 0;
    virtual uint32_t getDownlinkCount() const = 0;
    virtual void resetCounters() = 0;
};

// Forward declarations for RadioLib types
class SX1262;
class LoRaWANNode;

/**
 * LoRaWAN Hardware Abstraction Layer implementation using RadioLib
 * 
 * Class A Device Compliance:
 *   - Implements LoRaWAN Class A device behavior (LoRaWAN spec v1.0.x/1.1.x)
 *   - Opens RX1/RX2 windows after every uplink (confirmed or unconfirmed)
 *   - RX1 opens 1s after uplink (RECEIVE_DELAY1), RX2 opens 2s after uplink (RECEIVE_DELAY2)
 *   - Processes downlinks received in RX windows (ACKs, data, MAC commands)
 *   - RadioLib handles RX window timing internally
 * 
 * Instance Lifecycle:
 *   1. Create instance: LoRaWANHal hal;
 *   2. Initialize: hal.begin(devEui, appEui, appKey);
 *   3. Join network: hal.join(); (blocking, typically 5-15s)
 *   4. Send data: hal.sendData(port, payload, len, confirmed);
 *   5. Call tick() periodically: hal.tick(millis());
 *   6. Destructor cleans up resources automatically
 * 
 * Dependencies:
 *   - radio instance from heltec_unofficial.h (singleton, shared across instances)
 *   - RadioLib library for LoRaWAN protocol handling
 * 
 * Thread Safety:
 *   - Not thread-safe. All methods should be called from the same thread/task.
 *   - tick() must be called regularly (every 50ms recommended) to process downlinks promptly.
 *   - sendData() may block for 3-6 seconds during RX windows (Class A requirement).
 */
class LoRaWANHal : public ILoRaWANHal {
public:
    LoRaWANHal();
    ~LoRaWANHal() override;

    // ILoRaWANHal implementation
    bool begin(const uint8_t* devEui, const uint8_t* appEui, const uint8_t* appKey) override;
    void tick(uint32_t nowMs) override;

    bool sendData(uint8_t port, const uint8_t *payload, uint8_t length, bool confirmed = false) override;
    bool isReadyForTx() const override;

    void setOnDataReceived(OnDataReceived cb) override;
    void setOnTxDone(OnTxDone cb) override;
    void setOnTxTimeout(OnTxTimeout cb) override;

    bool isConnected() const override;
    ConnectionState getConnectionState() const override;
    int16_t getLastRssiDbm() const override;
    int8_t getLastSnr() const override;

    void setDeviceClass(uint8_t deviceClass) override;
    void setDataRate(uint8_t dataRate) override;
    void setTxPower(uint8_t txPower) override;
    void setAdr(bool enable) override;
    
    uint8_t getCurrentDataRate() const override;
    uint8_t getMaxPayloadSize() const override;

    bool isJoined() const override;
    bool isJoinInProgress() const;  // Check if join is currently in progress
    void join() override;
    void forceReconnect() override;

    uint32_t getUplinkCount() const override;
    uint32_t getDownlinkCount() const override;
    void resetCounters() override;

    // Debug helpers (not in interface, implementation-specific)
    const char* getRegionName() const;
    uint8_t getSubBand() const;

private:
    // Callbacks
    OnDataReceived onDataCb;
    OnTxDone onTxDoneCb;
    OnTxTimeout onTxTimeoutCb;

    // State
    ConnectionState connectionState = ConnectionState::Disconnected;
    uint32_t lastActivityMs = 0;
    int16_t lastRssiDbm = 0;
    int8_t lastSnr = 0;

    uint32_t uplinkCount = 0;
    uint32_t downlinkCount = 0;

    bool initialized = false;
    bool joined = false;  // Source of truth for join state
    bool joinInProgress = false;  // Prevents overlapping join attempts
    uint32_t lastJoinAttemptMs = 0;
    
    // Stored configuration for applying after join
    uint8_t configuredDataRate = 0;
    uint8_t configuredTxPower = 0;
    
    // Current data rate tracking (maintained internally since RadioLib may not expose it)
    uint8_t currentDataRate = 0;

    // Stored credentials for rejoin
    uint8_t storedDevEui[8];
    uint8_t storedAppEui[8];
    uint8_t storedAppKey[16];

    // LoRaWAN node instance (owned by this HAL instance, created in begin(), deleted in destructor)
    LoRaWANNode* node = nullptr;

    // Downlink buffer for receiving data from network (Class A RX windows)
    // Only data downlinks are queued here (ACKs are handled immediately)
    uint8_t downlinkBuffer[256];
    size_t downlinkLength = 0;
    uint8_t downlinkPort = 0;
    bool hasDownlink = false;  // Set when data downlink received, cleared in tick()
};
