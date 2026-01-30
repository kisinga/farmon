#include "ui_header_status_element.h"
#include "hal_display.h"
#include <cmath> // For sqrtf
#include <limits> // For std::numeric_limits

HeaderStatusElement::HeaderStatusElement() {
}

void HeaderStatusElement::setMode(Mode mode) {
    _mode = mode;
}

void HeaderStatusElement::setLoraStatus(bool connected, int16_t rssi) {
    _loraConnected = connected;
    _loraRssi = rssi;
}

void HeaderStatusElement::setTxFailMomentary(bool show) {
    _txFailMomentary = show;
}

void HeaderStatusElement::setPeerCount(uint16_t count) {
    _peerCount = count;
}

int16_t HeaderStatusElement::getWidth() const {
    switch (_mode) {
        case Mode::Lora: return 14;
        case Mode::PeerCount: {
            // Calculate width for "P:XXX" where XXX can be up to 3 digits
            // "P:" = 2 chars, "XXX" = 3 chars, total 5 chars * 6px each = 30px
            // Add some padding for safety
            return 35;
        }
    }
    return 14;
}

int16_t HeaderStatusElement::getWidthForColumn() const {
    // Return appropriate width based on the column this element will be used in
    switch (_mode) {
        case Mode::Lora:
            // LoRa icon width (calculated from bars)
            return 4 * 2 + 3 * 1; // 4 bars * 2px width + 3 gaps * 1px
        case Mode::PeerCount:
            // Peer count width - "P:" + number (up to 3 digits) = 2 + 3 chars
            return 5 * 6; // 5 characters * 6px per character
    }
    return 14;
}

void HeaderStatusElement::draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) {
    // The drawing functions are hardcoded to draw in the top bar.
    // The x, y, w, h from the layout are used to align within the column.
    switch (_mode) {
        case Mode::Lora:
            drawLoraSignal(display, x, y, w, h);
            break;
        case Mode::PeerCount:
            drawPeerCount(display, x, y, w, h);
            break;
    }
}

void HeaderStatusElement::drawLoraSignal(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h) {
    const int8_t bars = 4;
    const int8_t barWidth = 2;
    const int8_t barGap = 1;
    const int8_t maxBarHeight = h - 2;
    const int16_t totalWidth = bars * barWidth + (bars - 1) * barGap;
    int16_t startX = x + (w - totalWidth); // Right-align in the column

    uint8_t level = 0;
    if (_loraConnected && _loraRssi != std::numeric_limits<int16_t>::min()) {
        if (_loraRssi < -115) level = 1;
        else if (_loraRssi < -105) level = 2;
        else if (_loraRssi < -95) level = 3;
        else level = 4;
    } else {
        level = 0; // Explicitly set to 0 if not connected or RSSI is invalid
    }

    for (int i = 0; i < bars; i++) {
        int16_t barX = startX + i * (barWidth + barGap);
        int8_t barH = (int8_t)((i + 1) * maxBarHeight / bars);
        int16_t barY = y + (maxBarHeight - barH);
        if (i < level) {
            d.fillRect(barX, barY, barWidth, barH);
        } else {
            d.drawRect(barX, barY, barWidth, barH);
        }
    }
    // Draw an 'X' overlay if disconnected
    if (level == 0) {
        d.drawLine(startX, y, startX + totalWidth - 1, y + maxBarHeight - 1);
        d.drawLine(startX, y + maxBarHeight - 1, startX + totalWidth - 1, y);
    }
    // Momentary "TX fail" overlay: invert a small area and draw "!" when a send just failed
    if (_txFailMomentary) {
        d.setColor(2);  // INVERSE
        d.fillRect(startX, y, totalWidth, maxBarHeight);
        d.setColor(1);  // restore WHITE
    }
}

void HeaderStatusElement::drawPeerCount(IDisplayHal& d, int16_t x, int16_t y, int16_t w, int16_t h) {
    // Draw peer count with "P:" prefix (right-aligned like LoRa icon)
    const int8_t maxHeight = h - 2; // Leave space for separator line

    // Draw "P:" + peer count number at the bottom, right-aligned like LoRa icon
    String countStr = String("P:") + String((uint32_t)_peerCount);
    int16_t textWidth = countStr.length() * 6; // Approximate text width
    d.drawString(x + w - textWidth, y + maxHeight - 8, countStr); // Position above separator line
}
