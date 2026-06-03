#pragma once

#include "ui_element.h"

class IconElement : public UIElement {
public:
    explicit IconElement(const unsigned char* icon, int16_t width, int16_t height) 
        : _icon(icon), _width(width), _height(height) {}

    void draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) override {
        // Center the icon in the provided bounding box
        int16_t iconX = x + (w - _width) / 2;
        int16_t iconY = y + (h - _height) / 2;
        display.drawXbm(iconX, iconY, _width, _height, _icon);

        // Ensure proper text alignment for any text that might be drawn
        display.setTextAlignment(TEXT_ALIGN_LEFT);
    }

    int16_t getWidth() const override { return _width; }

private:
    const unsigned char* _icon;
    int16_t _width;
    int16_t _height;
};
