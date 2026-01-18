#pragma once

#include "common_message_types.h"
#include "hal_lorawan.h"
#include <memory>
#include <vector>

class ICommsService {
public:
    virtual ~ICommsService() = default;

    virtual void setLoRaWANHal(ILoRaWANHal* lorawanHal) = 0;
    
    virtual void update(uint32_t nowMs) = 0;
    virtual bool sendMessage(const Messaging::Message& message, TransportType transport) = 0;
};

class CommsService : public ICommsService {
public:
    CommsService();

    void setLoRaWANHal(ILoRaWANHal* lorawanHal) override;
    
    void update(uint32_t nowMs) override;
    bool sendMessage(const Messaging::Message& message, TransportType transport) override;

private:
    ILoRaWANHal* _lorawanHal = nullptr;
};
