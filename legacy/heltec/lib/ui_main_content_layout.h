#pragma once

#include "ui_layout.h"
#include "ui_element.h"

class MainContentLayout : public Layout {
public:
    explicit MainContentLayout(IDisplayHal& display);

    void draw() override;
    void setLeft(UIElement* element);
    void setRight(UIElement* element);
    void setLeftColumnWidth(int16_t width);

private:
    UIElement* _left = nullptr;
    UIElement* _right = nullptr;
    int16_t _leftColWidth = -1; // -1 means use default 35%
};
