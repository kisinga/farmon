#pragma once

#include <stdint.h>
#include "hal_lorawan.h"

// Message types for backward compatibility with existing code
enum class CommandType : uint8_t {
    // Existing commands
    ResetWaterVolume = 0x01,
    // Add more LoRaWAN-specific commands here
    SetReportingInterval = 0x02,
    GetDeviceStatus = 0x03,
    RebootDevice = 0x04,
};

class ILoRaWANService {
public:
    // Use the HAL's ConnectionState for consistency
    using ConnectionState = ILoRaWANHal::ConnectionState;

    virtual ~ILoRaWANService() = default;

    // Lifecycle
    virtual void update(uint32_t nowMs) = 0;

    // Connection status
    virtual bool isConnected() const = 0;
    virtual ConnectionState getConnectionState() const = 0;

    // Signal quality (for UI compatibility)
    virtual int16_t getLastRssiDbm() const = 0;
    virtual int8_t getLastSnr() const = 0;

    // Data transmission - adapted for LoRaWAN
    virtual bool sendData(uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed = false) = 0;

    // Legacy compatibility - these don't make sense in LoRaWAN but provide stubs
    virtual size_t getPeerCount() const = 0;  // Always returns 1 (the gateway)
    virtual size_t getTotalPeerCount() const = 0;  // Always returns 1 (the gateway)

    // LoRaWAN specific methods
    virtual bool isJoined() const = 0;
    virtual void join() = 0;
    virtual void forceReconnect() = 0;

    // Statistics
    virtual uint32_t getUplinkCount() const = 0;
    virtual uint32_t getDownlinkCount() const = 0;
    virtual void resetCounters() = 0;

    // Configuration (for future use)
    virtual void setDefaultPort(uint8_t port) = 0;
    virtual void setDefaultConfirmed(bool confirmed) = 0;
};

class LoRaWANService : public ILoRaWANService {
public:
    explicit LoRaWANService(ILoRaWANHal& hal);

    // ILoRaWANService implementation
    void update(uint32_t nowMs) override;

    bool isConnected() const override;
    ConnectionState getConnectionState() const override;

    int16_t getLastRssiDbm() const override;
    int8_t getLastSnr() const override;

    bool sendData(uint8_t port, const uint8_t* payload, uint8_t len, bool confirmed = false) override;

    size_t getPeerCount() const override;
    size_t getTotalPeerCount() const override;

    bool isJoined() const override;
    void join() override;
    void forceReconnect() override;

    uint32_t getUplinkCount() const override;
    uint32_t getDownlinkCount() const override;
    void resetCounters() override;

    void setDefaultPort(uint8_t port) override;
    void setDefaultConfirmed(bool confirmed) override;

private:
    ILoRaWANHal& lorawanHal;

    // Default configuration
    uint8_t defaultPort = 1;
    bool defaultConfirmed = false;

    // Track last activity for connection state management
    uint32_t lastActivityMs = 0;
    uint32_t connectionTimeoutMs = 30000; // 30 seconds timeout

    // Callbacks for HAL events
    void onDataReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    void onTxDone();
    void onTxTimeout();

    // Static callback wrappers for HAL
    static void staticOnDataReceived(uint8_t port, const uint8_t* payload, uint8_t length);
    static void staticOnTxDone();
    static void staticOnTxTimeout();
    static LoRaWANService* callbackInstance;
};
