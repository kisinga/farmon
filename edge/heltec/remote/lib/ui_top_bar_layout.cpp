#include "ui_top_bar_layout.h"
#include "ui_element.h"
#include "ui_text_element.h" // For type checking

TopBarLayout::TopBarLayout(IDisplayHal& display) : Layout(display) {
    _columns.fill(nullptr);
}

void TopBarLayout::setColumn(int index, UIElement* element) {
    if (index >= 0 && index < 4) {
        _columns[index] = element;
    }
}

void TopBarLayout::setColumn(TopBarColumn column, UIElement* element) {
    setColumn(static_cast<int>(column), element);
}

void TopBarLayout::drawLeftAlignedText(UIElement* element, int16_t x, int16_t y, int16_t w, int16_t h) {
    // Left-align text elements with no additional padding
    element->draw(_display, x, y, w, h);
}

void TopBarLayout::drawCenteredElement(UIElement* element, int16_t x, int16_t y, int16_t w, int16_t h) {
    // Center-align icons and other elements
    int16_t elementWidth = element->getWidth();
    int16_t centeredX = x + (w - elementWidth) / 2;
    element->draw(_display, centeredX, y, w, h);
}

// Helper to get the appropriate width for an element
int16_t getElementWidth(UIElement* element) {
    // Use getWidthForColumn - all elements implement this virtual method
    return element->getWidthForColumn();
}

void TopBarLayout::draw() {
    // Define column widths based on content type
    // Total must fit within 128px display width including spacing
    const int16_t columnWidths[4] = {28, 24, 24, 35}; // Total: 111px
    const int16_t columnSpacing = 4; // Space between columns

    int16_t currentX = 0;
    for (int i = 0; i < 4; ++i) {
        if (_columns[i]) {
            // Apply consistent alignment based on column purpose
            if (i == static_cast<int>(TopBarColumn::DeviceId) ||
                i == static_cast<int>(TopBarColumn::Network)) {
                // Left-align text elements (ID and peer count)
                drawLeftAlignedText(_columns[i], currentX, 0, columnWidths[i], 10);
            } else {
                // Center-align icons (battery and communication)
                // Use getElementWidth for proper alignment
                int16_t elementWidth = getElementWidth(_columns[i]);
                int16_t centeredX = currentX + (columnWidths[i] - elementWidth) / 2;
                _columns[i]->draw(_display, centeredX, 0, columnWidths[i], 10);
            }
        }
        currentX += columnWidths[i] + columnSpacing;
    }

    // Draw separator line
    _display.drawHorizontalLine(0, 12, 128);
}
