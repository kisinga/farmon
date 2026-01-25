#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Setup Build Environment for Heltec V3
# =============================================================================
# Configures Arduino CLI and installs required board support and libraries

log()  { echo -e "\033[0;36m→\033[0m $1"; }
ok()   { echo -e "\033[0;32m✓\033[0m $1"; }
warn() { echo -e "\033[0;33m⚠\033[0m $1"; }
err()  { echo -e "\033[0;31m✗\033[0m $1" >&2; exit 1; }

# Get script directory for relative path checks
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find arduino-cli in multiple locations
find_arduino_cli() {
    # Check system PATH first
    if command -v arduino-cli &> /dev/null; then
        which arduino-cli
        return 0
    fi
    
    # Check local project bin directory
    if [ -f "$SCRIPT_DIR/bin/arduino-cli" ]; then
        echo "$SCRIPT_DIR/bin/arduino-cli"
        return 0
    fi
    
    # Check user bin directory
    if [ -f "$HOME/bin/arduino-cli" ]; then
        echo "$HOME/bin/arduino-cli"
        return 0
    fi
    
    return 1
}

# Find or install arduino-cli
ARDUINO_CLI=""
if ARDUINO_CLI=$(find_arduino_cli); then
    ok "arduino-cli found: $ARDUINO_CLI"
    # Add directory to PATH if it's not already there
    ARDUINO_CLI_DIR=$(dirname "$ARDUINO_CLI")
    if [[ ":$PATH:" != *":$ARDUINO_CLI_DIR:"* ]]; then
        export PATH="$ARDUINO_CLI_DIR:$PATH"
    fi
else
    warn "arduino-cli not found in PATH"
    log "Installing arduino-cli..."
    
    # Ensure $HOME/bin exists
    mkdir -p "$HOME/bin"
    
    # Install to $HOME/bin by setting INSTALL_DIR
    export INSTALL_DIR="$HOME/bin"
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh | sh
    
    # Add to PATH for this session
    export PATH="$HOME/bin:$PATH"
    
    # Verify installation
    if ARDUINO_CLI=$(find_arduino_cli); then
        ok "arduino-cli installed: $ARDUINO_CLI"
    else
        # Check if it was installed to current directory
        if [ -f "./bin/arduino-cli" ]; then
            ARDUINO_CLI="./bin/arduino-cli"
            export PATH="$(pwd)/bin:$PATH"
            ok "arduino-cli installed to local bin: $ARDUINO_CLI"
        else
            err "Failed to install arduino-cli. Please install manually."
        fi
    fi
fi

# Verify arduino-cli is executable
if [ ! -x "$ARDUINO_CLI" ]; then
    err "arduino-cli found but not executable: $ARDUINO_CLI"
fi

# Initialize config if needed
if [ ! -f "$HOME/.arduino15/arduino-cli.yaml" ]; then
    log "Initializing Arduino CLI config..."
    "$ARDUINO_CLI" config init
    ok "Config initialized"
fi

# Add ESP32 board URL (Espressif official, not Heltec)
log "Adding ESP32 board manager URL..."
if ! "$ARDUINO_CLI" config dump | grep -q "espressif.github.io"; then
    "$ARDUINO_CLI" config add board_manager.additional_urls \
        https://espressif.github.io/arduino-esp32/package_esp32_index.json
    ok "ESP32 board URL added"
else
    ok "ESP32 board URL already configured"
fi

# Update board index
log "Updating board index..."
"$ARDUINO_CLI" core update-index
ok "Board index updated"

# Install ESP32 core
log "Installing ESP32 board support package..."
if ! "$ARDUINO_CLI" core list | grep -q "esp32:esp32"; then
    "$ARDUINO_CLI" core install esp32:esp32
    ok "ESP32 core installed"
else
    ok "ESP32 core already installed"
fi

# Verify Heltec library is installed
log "Checking for Heltec_ESP32_LoRa_v3 library..."
if [ -d "$HOME/Arduino/libraries/Heltec_ESP32_LoRa_v3" ]; then
    ok "Heltec_ESP32_LoRa_v3 library found"
    log "Library version: $(grep '^version=' "$HOME/Arduino/libraries/Heltec_ESP32_LoRa_v3/library.properties" | cut -d= -f2)"
else
    warn "Heltec_ESP32_LoRa_v3 library not found in ~/Arduino/libraries/"
    log "Install it via Arduino IDE Library Manager or:"
    log "  cd ~/Arduino/libraries && git clone https://github.com/ropg/Heltec_ESP32_LoRa_v3.git"
fi

# Install ArduinoJson library (required for JSON message protocol)
log "Installing ArduinoJson library..."
if "$ARDUINO_CLI" lib list | grep -q "ArduinoJson"; then
    ok "ArduinoJson library already installed"
else
    "$ARDUINO_CLI" lib install "ArduinoJson@6.21.5"
    ok "ArduinoJson library installed"
fi

# List available boards
log "Available ESP32 boards:"
"$ARDUINO_CLI" board listall | grep -i "heltec\|esp32" | head -10 || true

ok "Setup complete!"
echo ""
log "Next steps:"
echo "  1. Ensure secrets.h exists (copy from secrets.example.h)"
echo "  2. Run: ./heltec.sh build"
echo ""
