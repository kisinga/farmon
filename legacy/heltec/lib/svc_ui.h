#pragma once

#include "hal_display.h"
#include "ui_screen_layout.h"
#include "logo.h" // For splash screen
#include <cstring>

// Notification for temporary on-screen messages
struct Notification {
    char line1[24] = {0};
    char line2[32] = {0};
    uint32_t expiresMs = 0;    // 0 = inactive
    bool fullScreen = false;
};

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

    // Notifications
    void showNotification(const char* line1, const char* line2,
                          uint32_t durationMs, bool fullScreen = false);
    void clearNotification();

private:
    void drawSplashScreen();
    void drawFullScreenNotification();
    void drawOverlayNotification();

    IDisplayHal& _displayHal;
    ScreenLayout _screenLayout;
    UIState _state = UIState::Splash;
    uint32_t _splashStartedMs = 0;
    static const uint32_t SPLASH_DURATION_MS = 1200;

    // Notification state
    Notification _notification;
};
