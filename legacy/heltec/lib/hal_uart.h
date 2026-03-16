// Minimal UART/RS485 abstraction for integrations.
// Integrations use this interface so they do not depend on HardwareSerial directly.
// Device provides a concrete implementation (e.g. wrapping Serial2 and DE/RE pins).

#pragma once

#include <stdint.h>
#include <stddef.h>

class IUartHal {
public:
    virtual ~IUartHal() = default;

    // Write bytes; returns number written
    virtual size_t write(const uint8_t* data, size_t len) = 0;

    // Read up to len bytes; returns number read
    virtual size_t read(uint8_t* data, size_t len) = 0;

    // Number of bytes available to read
    virtual int available() = 0;

    // Optional: set RS485 direction (true = transmit, false = receive). Default no-op.
    virtual void setDirection(bool tx) { (void)tx; }
};
