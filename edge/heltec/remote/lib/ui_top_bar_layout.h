#pragma once

#include "ui_layout.h"
#include "ui_element.h"
#include <array>

// Standard column definitions for consistent UI layout
enum class TopBarColumn {
    DeviceId = 0,      // Left-aligned text (ID: XX)
    Battery = 1,       // Centered icon (battery status)
    Status = 2,        // Centered icons (WiFi status)
    Network = 3        // Centered icons (peer count, LoRa status)
};

class TopBarLayout : public Layout {
public:
    explicit TopBarLayout(IDisplayHal& display);

    void draw() override;

    // Set column using enum for better consistency
    void setColumn(TopBarColumn column, UIElement* element);

    // Legacy method for backward compatibility
    void setColumn(int index, UIElement* element);

private:
    std::array<UIElement*, 4> _columns;

    // Alignment helpers
    void drawLeftAlignedText(UIElement* element, int16_t x, int16_t y, int16_t w, int16_t h);
    void drawCenteredElement(UIElement* element, int16_t x, int16_t y, int16_t w, int16_t h);
};
