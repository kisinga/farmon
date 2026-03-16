#pragma once

#include "ui_element.h"
#include <Arduino.h>

class TextElement : public UIElement {
public:
    TextElement() = default;
    explicit TextElement(const String& text) : _text(text) {}

    void setText(const String& text) {
        _text = text;
    }

    void draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) override {
        // Handle text alignment and respect the bounding box
        display.setTextAlignment(TEXT_ALIGN_LEFT);
        display.drawString(x, y, _text);
    }

    int16_t getWidth() const override {
        // This is a rough estimate. For accurate width, we would need
        // access to the display driver to measure the string.
        return _text.length() * 6; // Assume avg char width of 6px for Arial 10
    }

private:
    String _text;
};
