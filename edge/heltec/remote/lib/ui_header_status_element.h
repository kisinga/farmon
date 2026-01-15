#pragma once

#include "ui_element.h"
#include <Arduino.h>
#include <limits>

class HeaderStatusElement : public UIElement {
public:
    enum class Mode {
        Lora,
        Wifi,
        PeerCount
    };

    HeaderStatusElement();
    void setMode(Mode mode);
    void setLoraStatus(bool connected, int16_t rssi);
    void setWifiStatus(bool connected, int8_t signalStrength);
    void setPeerCount(uint16_t count);
    void draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) override;

    // Provide width for layout calculations
    // Width depends on mode and intended column usage
    int16_t getWidth() const override;
    int16_t getWidthForColumn() const override; // Returns appropriate width for column usage

private:
    void drawLoraSignal(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h);
    void drawWifiStatus(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h);
    void drawPeerCount(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h);

    Mode _mode = Mode::Lora;

    // State for all modes
    bool _loraConnected = false;
    int16_t _loraRssi = std::numeric_limits<int16_t>::min();
    bool _wifiConnected = false;
    int8_t _wifiSignalStrength = -1;
    uint16_t _peerCount = 0;
};
