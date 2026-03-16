#include "ui_battery_icon_element.h"
#include "hal_display.h"
#include <Arduino.h> // For millis() and min()
#include <algorithm> // For std::max

BatteryIconElement::BatteryIconElement() {}

void BatteryIconElement::setStatus(uint8_t percent, bool isCharging) {
    _isCharging = isCharging;
    const uint8_t clamped = percent > 100 ? 100 : percent;

    if (!_filterInitialized) {
        _percentFiltered = (float)clamped;
        _filterInitialized = true;
    } else {
        // Low-pass filter to stabilize UI bars and reduce flicker
        const float alpha = 0.30f; // weight of new sample
        _percentFiltered = (1.0f - alpha) * _percentFiltered + alpha * (float)clamped;
    }
    _percent = clamped;
}

void BatteryIconElement::draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) {
    // Center the icon within the given area. Default size is 22x10.
    const int16_t iconW = 22;
    const int16_t iconH = 10;
    int16_t iconX = x + (w - iconW) / 2;
    int16_t iconY = y + (h - iconH) / 2;

    const bool showBars = !_isCharging;
    const uint8_t percentToDraw = (uint8_t)(_percentFiltered + 0.5f);
    drawBatteryIcon(display, iconX, iconY, iconW, iconH, showBars ? percentToDraw : 255);
    if (_isCharging) {
        drawChargingBolt(display, iconX, iconY, iconW, iconH);
    }
}

void BatteryIconElement::drawBatteryIcon(IDisplayHal& d, int16_t x, int16_t y, int16_t bodyW, int16_t bodyH, uint8_t percent) {
    if (bodyW < 14) bodyW = 14;
    if (bodyH < 8) bodyH = 8;

    d.drawRect(x, y, bodyW, bodyH);
    const int16_t tipW = 2;
    const int16_t tipH = std::max<int16_t>(4, bodyH / 2);
    const int16_t tipY = y + ((bodyH - tipH) / 2);
    d.fillRect(x + bodyW, tipY, tipW, tipH);

    const int16_t ix = x + 2;
    const int16_t iy = y + 2;
    const int16_t iw = bodyW - 4;
    const int16_t ih = bodyH - 4;

    if (percent <= 100) {
        const int16_t fillW = (int16_t)((iw * percent) / 100);
        if (percent <= 15) {
            for (int16_t fx = ix; fx < ix + fillW; fx += 2) {
                d.fillRect(fx, iy, 1, ih);
            }
        } else {
            d.fillRect(ix, iy, fillW, ih);
            if (fillW > 2) {
                d.setPixel(ix + 1, iy);
                d.setPixel(ix + fillW - 2, iy);
            }
        }
    }
}

void BatteryIconElement::drawChargingBolt(IDisplayHal& d, int16_t x, int16_t y, int16_t bodyW, int16_t bodyH) {
    static uint32_t lastAnimMs = 0;
    static uint8_t animPhase = 0;
    const uint32_t nowMs = millis();
    
    if (nowMs - lastAnimMs >= 250) {
        animPhase = (animPhase + 1) % 4;
        lastAnimMs = nowMs;
    }

    const int16_t ix = x + 2;
    const int16_t iy = y + 1;
    const int16_t iw = bodyW - 4;
    const int16_t ih = bodyH - 2;

    const int16_t arrowH = ih / 2;
    const int16_t arrowW = std::min<int16_t>(6, iw / 2);
    const int16_t centerX = ix + iw / 2;
    
    if (animPhase < 2) {
        const int16_t y1 = iy + 1;
        d.drawLine(centerX - 2, y1 + arrowH - 1, centerX, y1);
        d.drawLine(centerX, y1, centerX + 2, y1 + arrowH - 1);
        d.drawLine(centerX, y1, centerX, y1 + arrowH);
    }
    if (animPhase > 1) {
        const int16_t y2 = iy + ih - arrowH;
        d.drawLine(centerX - 2, y2 + arrowH - 1, centerX, y2);
        d.drawLine(centerX, y2, centerX + 2, y2 + arrowH - 1);
        d.drawLine(centerX, y2, centerX, y2 + arrowH);
    }
}
