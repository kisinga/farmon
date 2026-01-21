#pragma once

#include <Arduino.h>
#include "hal_display.h"

// Base class for all UI elements
class UIElement {
public:
    virtual ~UIElement() = default;

    // Draw the element within the given bounding box
    virtual void draw(IDisplayHal& display, int16_t x, int16_t y, int16_t w, int16_t h) = 0;
    virtual int16_t getWidth() const { return 0; } // Default width
    virtual int16_t getWidthForColumn() const { return getWidth(); } // Width for column usage
};
