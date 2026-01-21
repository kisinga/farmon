#pragma once

#include "hal_display.h"
#include "ui_screen_layout.h"
#include "logo.h" // For splash screen

class UiService {
public:
    enum class UIState {
        Splash,
        Home
    };

    explicit UiService(IDisplayHal& displayHal);

    void init();
    void tick();

    ScreenLayout& getLayout() { return _screenLayout; }

private:
    void drawSplashScreen();

    IDisplayHal& _displayHal;
    ScreenLayout _screenLayout;
    UIState _state = UIState::Splash;
    uint32_t _splashStartedMs = 0;
    static const uint32_t SPLASH_DURATION_MS = 1200;
};
