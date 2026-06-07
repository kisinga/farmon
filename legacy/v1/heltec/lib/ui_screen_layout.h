#pragma once

#include "ui_layout.h"
#include "ui_top_bar_layout.h"
#include "ui_main_content_layout.h"

class ScreenLayout : public Layout {
public:
    explicit ScreenLayout(IDisplayHal& display);
    void draw() override;

    TopBarLayout& getTopBar() { return _topBar; }
    MainContentLayout& getMainContent() { return _mainContent; }

private:
    TopBarLayout _topBar;
    MainContentLayout _mainContent;
};
