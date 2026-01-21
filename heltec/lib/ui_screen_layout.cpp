#include "ui_screen_layout.h"

ScreenLayout::ScreenLayout(IDisplayHal& display)
    : Layout(display), _topBar(display), _mainContent(display) {
}

void ScreenLayout::draw() {
    _topBar.draw();
    _mainContent.draw();
}
