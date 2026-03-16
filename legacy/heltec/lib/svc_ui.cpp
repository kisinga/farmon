#include "svc_ui.h"
#include "logo.cpp"
#include "OLEDDisplayFonts.h"

UiService::UiService(IDisplayHal& displayHal)
    : _displayHal(displayHal),
      _screenLayout(displayHal) {
}

void UiService::init() {
    _splashStartedMs = millis();
    _state = UIState::Splash;
    drawSplashScreen();
    _displayHal.display();
}

void UiService::tick() {
    uint32_t now = millis();

    _displayHal.clear();

    // Check notification expiry
    if (_notification.expiresMs > 0 && now > _notification.expiresMs) {
        clearNotification();
    }

    // Draw based on state and notification
    if (_notification.expiresMs > 0 && _notification.fullScreen) {
        drawFullScreenNotification();
    } else {
        switch (_state) {
            case UIState::Splash:
                drawSplashScreen();
                if (now - _splashStartedMs > SPLASH_DURATION_MS) {
                    _state = UIState::Home;
                }
                break;

            case UIState::Home:
                _screenLayout.draw();
                break;
        }

        // Overlay notification at bottom if active
        if (_notification.expiresMs > 0 && !_notification.fullScreen) {
            drawOverlayNotification();
        }
    }

    _displayHal.display();
}

void UiService::showNotification(const char* line1, const char* line2,
                                  uint32_t durationMs, bool fullScreen) {
    strncpy(_notification.line1, line1 ? line1 : "", sizeof(_notification.line1) - 1);
    _notification.line1[sizeof(_notification.line1) - 1] = '\0';

    strncpy(_notification.line2, line2 ? line2 : "", sizeof(_notification.line2) - 1);
    _notification.line2[sizeof(_notification.line2) - 1] = '\0';

    _notification.expiresMs = millis() + durationMs;
    _notification.fullScreen = fullScreen;
}

void UiService::clearNotification() {
    _notification.line1[0] = '\0';
    _notification.line2[0] = '\0';
    _notification.expiresMs = 0;
    _notification.fullScreen = false;
}

void UiService::drawSplashScreen() {
    _displayHal.drawXbm(32, 0, 64, 64, logo_bits);
}

void UiService::drawFullScreenNotification() {
    _displayHal.setFont(ArialMT_Plain_16);
    _displayHal.setTextAlignment(TEXT_ALIGN_CENTER);
    _displayHal.drawString(64, 16, _notification.line1);

    if (_notification.line2[0] != '\0') {
        _displayHal.setFont(ArialMT_Plain_10);
        _displayHal.drawString(64, 38, _notification.line2);
    }

    // Restore defaults so the next normal draw cycle isn't polluted
    _displayHal.setFont(ArialMT_Plain_10);
    _displayHal.setTextAlignment(TEXT_ALIGN_LEFT);
}

void UiService::drawOverlayNotification() {
    constexpr uint8_t COLOR_BLACK = 0;
    constexpr uint8_t COLOR_WHITE = 1;

    _displayHal.setColor(COLOR_WHITE);
    _displayHal.fillRect(0, 48, 128, 16);

    _displayHal.setColor(COLOR_BLACK);
    _displayHal.setFont(ArialMT_Plain_10);
    _displayHal.setTextAlignment(TEXT_ALIGN_LEFT);

    char combined[48];
    if (_notification.line2[0] != '\0') {
        snprintf(combined, sizeof(combined), "%s %s", _notification.line1, _notification.line2);
    } else {
        strncpy(combined, _notification.line1, sizeof(combined) - 1);
        combined[sizeof(combined) - 1] = '\0';
    }
    _displayHal.drawString(2, 50, combined);

    _displayHal.setColor(COLOR_WHITE);
}
