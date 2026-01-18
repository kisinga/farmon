#include "svc_ui.h"
#include "logo.cpp"

UiService::UiService(IDisplayHal& displayHal)
    : _displayHal(displayHal),
      _screenLayout(displayHal) {
}

void UiService::init() {
    _splashStartedMs = millis();
    _state = UIState::Splash;
    drawSplashScreen();
}

void UiService::tick() {
    // Clear the display at the beginning of each tick
    _displayHal.clear();

    switch (_state) {
        case UIState::Splash:
            drawSplashScreen(); // Redraw every tick
            if (millis() - _splashStartedMs > SPLASH_DURATION_MS) {
                _state = UIState::Home;
            }
            break;

        case UIState::Home:
            // The ScreenLayout needs to be initialized with elements.
            // This should happen in a setup method or be driven by app state.
            _screenLayout.draw();
            break;
    }

    // Display the buffer after all drawing is complete for the current state
    _displayHal.display();
}

void UiService::drawSplashScreen() {
    // The clear is now handled in tick()
    _displayHal.drawXbm(32, 0, 64, 64, logo_bits);
}
