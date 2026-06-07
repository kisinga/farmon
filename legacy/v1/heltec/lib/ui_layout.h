#pragma once

#include "hal_display.h"

// Base class for layout containers
class Layout {
public:
    explicit Layout(IDisplayHal& display) : _display(display) {}
    virtual ~Layout() = default;

    virtual void draw() = 0;
    virtual void update() { /* optional */ }

protected:
    IDisplayHal& _display;
};
