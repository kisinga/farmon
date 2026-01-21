#include "ui_main_content_layout.h"

MainContentLayout::MainContentLayout(IDisplayHal& display) : Layout(display) {
}

void MainContentLayout::setLeft(UIElement* element) {
    _left = element;
}

void MainContentLayout::setRight(UIElement* element) {
    _right = element;
}

void MainContentLayout::setLeftColumnWidth(int16_t width) {
    _leftColWidth = width;
}

void MainContentLayout::draw() {
    const int16_t headerSeparatorY = 12; // Y position of the top bar's separator line
    const int16_t contentY = headerSeparatorY + 2;
    const int16_t contentH = 64 - contentY;

    const int16_t col1Width = (_leftColWidth > 0) ? _leftColWidth : 128 * 0.35;
    const int16_t col2Width = 128 - col1Width;
    const int16_t col2X = col1Width;

    if (_left) {
        _left->draw(_display, 0, contentY, col1Width, contentH);
    }
    if (_right) {
        _right->draw(_display, col2X, contentY, col2Width, contentH);
    }
}
