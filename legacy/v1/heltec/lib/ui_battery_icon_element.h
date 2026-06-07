#pragma once

#include "ui_element.h"

class BatteryIconElement : public UIElement {
public:
    BatteryIconElement();
    void setStatus(uint8_t percent, bool isCharging);
    void draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) override;

    // Provide width for layout calculations
    int16_t getWidth() const { return 22; }

private:
    void drawBatteryIcon(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h, uint8_t percent);
    void drawChargingBolt(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h);

    uint8_t _percent = 100;
    bool _isCharging = false;
    bool _filterInitialized = false;
    float _percentFiltered = 0.0f;
};
