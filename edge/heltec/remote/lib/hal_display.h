#pragma once

#include <stdint.h>
#include <Arduino.h> // For Print class
#include "display.h"
#include "HT_SSD1306Wire.h" // Include for TEXT_ALIGNMENT enum

// Forward declaration of the display class
class SSD1306Wire;

class IDisplayHal {
public:
    virtual ~IDisplayHal() = default;

    virtual SSD1306Wire& getDisplay() = 0;

    virtual bool begin() = 0;
    virtual void clear() = 0;
    virtual void display() = 0;
    
    virtual void setFont(const uint8_t* fontData) = 0;
    virtual void setTextAlignment(int alignment) = 0;
    virtual void drawString(int16_t x, int16_t y, const String& text) = 0;
    virtual void drawXbm(int16_t x, int16_t y, int16_t width, int16_t height, const uint8_t* xbm) = 0;
    virtual void drawHorizontalLine(int16_t x, int16_t y, int16_t length) = 0;
    virtual void drawRect(int16_t x, int16_t y, int16_t w, int16_t h) = 0;
    virtual void fillRect(int16_t x, int16_t y, int16_t w, int16_t h) = 0;
    virtual void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1) = 0;
    virtual void setPixel(int16_t x, int16_t y) = 0;
};

class OledDisplayHal : public IDisplayHal {
public:
    OledDisplayHal();
    SSD1306Wire& getDisplay() override;
    bool begin() override;
    void clear() override;
    void display() override;
    void setFont(const uint8_t* fontData) override;
    void setTextAlignment(int alignment) override;
    void drawString(int16_t x, int16_t y, const String& text) override;
    void drawXbm(int16_t x, int16_t y, int16_t width, int16_t height, const uint8_t* xbm) override;
    void drawHorizontalLine(int16_t x, int16_t y, int16_t length) override;
    void drawRect(int16_t x, int16_t y, int16_t w, int16_t h) override;
    void fillRect(int16_t x, int16_t y, int16_t w, int16_t h) override;
    void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1) override;
    void setPixel(int16_t x, int16_t y) override;

private:
    OledDisplay _oled;
};

OledDisplayHal::OledDisplayHal() : _oled() {}

SSD1306Wire& OledDisplayHal::getDisplay() {
    return _oled.getDisplay();
}

bool OledDisplayHal::begin() {
    return _oled.safeBegin(true);
}

void OledDisplayHal::clear() {
    _oled.getDisplay().clear();
}

void OledDisplayHal::display() {
    _oled.getDisplay().display();
}

void OledDisplayHal::setFont(const uint8_t* fontData) {
    _oled.getDisplay().setFont(fontData);
}

void OledDisplayHal::setTextAlignment(int alignment) {
    _oled.getDisplay().setTextAlignment((DISPLAY_TEXT_ALIGNMENT)alignment);
}

void OledDisplayHal::drawString(int16_t x, int16_t y, const String& text) {
    _oled.getDisplay().drawString(x, y, text);
}

void OledDisplayHal::drawXbm(int16_t x, int16_t y, int16_t width, int16_t height, const uint8_t* xbm) {
    _oled.getDisplay().drawXbm(x, y, width, height, xbm);
}

void OledDisplayHal::drawHorizontalLine(int16_t x, int16_t y, int16_t length) {
    _oled.getDisplay().drawHorizontalLine(x, y, length);
}

void OledDisplayHal::drawRect(int16_t x, int16_t y, int16_t w, int16_t h) {
    _oled.getDisplay().drawRect(x, y, w, h);
}

void OledDisplayHal::fillRect(int16_t x, int16_t y, int16_t w, int16_t h) {
    _oled.getDisplay().fillRect(x, y, w, h);
}

void OledDisplayHal::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
    _oled.getDisplay().drawLine(x0, y0, x1, y1);
}

void OledDisplayHal::setPixel(int16_t x, int16_t y) {
    _oled.getDisplay().setPixel(x, y);
}
