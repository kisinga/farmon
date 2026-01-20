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

    // Join and session management
    virtual bool isJoined() const = 0;
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

    bool isJoined() const override;
    void join() override;
    void forceReconnect() override;

    uint32_t getUplinkCount() const override;
    uint32_t getDownlinkCount() const override;
    void resetCounters() override;

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
    bool joined = false;
    bool joinInProgress = false;
    uint32_t lastJoinAttemptMs = 0;

    // Stored credentials for rejoin
    uint8_t storedDevEui[8];
    uint8_t storedAppEui[8];
    uint8_t storedAppKey[16];

    // LoRaWAN node pointer (managed externally by heltec library)
    LoRaWANNode* node = nullptr;
};
