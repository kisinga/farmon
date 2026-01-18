#pragma once

#include <stdint.h>
#include <string.h>
#include <Arduino.h>

// Transport types for identification
enum class TransportType : uint8_t {
    WiFi = 0,
    LoRaWAN = 1,
    USB_Debug = 2,
    Screen = 3,
    I2C_Bus = 4,
    Unknown = 255
};

// Connection states
enum class ConnectionState : uint8_t {
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Error = 3
};

// Transport capabilities
struct TransportCapabilities {
    bool canSend : 1;
    bool canReceive : 1;
    bool supportsAck : 1;
    bool supportsBroadcast : 1;
    bool requiresConnection : 1;
    bool isReliable : 1;
};

namespace Messaging {

    // Sub-types for command messages
    enum class CommandType : uint8_t {
        // Add other command types here
        ResetWaterVolume = 0x01
    };

    class Message {
    public:
        // Message types to categorize different kinds of data
        enum class Type : uint8_t {
            Data = 0,
            Command = 1,
            Status = 2,
            Debug = 3,
            Telemetry = 4,
            Heartbeat = 5
        };

        // Metadata for routing and processing
        struct Metadata {
            uint32_t timestamp;
            uint8_t sourceId;
            uint8_t destinationId;
            Type type;
            uint16_t sequenceId;
            bool requiresAck;
        };

        // Constructor for creating messages
        Message(Type msgType = Type::Data, uint8_t srcId = 0, uint8_t dstId = 0xFF,
                bool ackRequired = false, const uint8_t* data = nullptr, uint16_t dataLen = 0)
            : length(dataLen) {

            metadata.timestamp = millis();
            metadata.sourceId = srcId;
            metadata.destinationId = dstId;
            metadata.type = msgType;
            metadata.sequenceId = nextSequenceId++;
            metadata.requiresAck = ackRequired;

            if (data && dataLen > 0 && dataLen <= kMaxPayloadSize) {
                memcpy(payload, data, dataLen);
                length = dataLen;
            }
        }

        // Accessors
        const Metadata& getMetadata() const { return metadata; }
        const uint8_t* getPayload() const { return payload; }
        uint16_t getLength() const { return length; }
        Type getType() const { return metadata.type; }

        // Modifiers
        void setSourceId(uint8_t id) { metadata.sourceId = id; }
        void setDestinationId(uint8_t id) { metadata.destinationId = id; }
        void setType(Type type) { metadata.type = type; }
        void setRequiresAck(bool ack) { metadata.requiresAck = ack; }

        // Utility methods
        bool isBroadcast() const { return metadata.destinationId == 0xFF; }
        bool isEmpty() const { return length == 0; }

        // Static method to reset the global sequence counter
        static void resetSequenceId() {
            nextSequenceId = 1;
        }

        // Static constants
        static constexpr uint16_t kMaxPayloadSize = 64;
        static constexpr uint16_t kTotalSize = sizeof(Metadata) + kMaxPayloadSize;

    private:
        Metadata metadata;
        uint8_t payload[kMaxPayloadSize];
        uint16_t length;

        static inline uint16_t nextSequenceId = 1; // Global sequence counter
    };

} // namespace Messaging
