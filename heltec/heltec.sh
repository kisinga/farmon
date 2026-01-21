#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Heltec Build Script
# =============================================================================
# Builds and uploads Arduino sketches for Heltec ESP32 LoRa V3
#
# Usage:
#   ./heltec.sh build [sketch]           Build sketch (default: current dir)
#   ./heltec.sh upload [sketch] [port]   Upload to device
#   ./heltec.sh flash [sketch] [port]    Build and upload
#   ./heltec.sh monitor [port]           Open serial monitor
#
# Environment:
#   LORAWAN_REGION   - US915, EU868, AU915, AS923 (default: US915)
#   LORAWAN_SUBBAND  - 1-8 for US915/AU915 (default: 2)

# --- Configuration ---
LORAWAN_REGION="${LORAWAN_REGION:-US915}"
LORAWAN_SUBBAND="${LORAWAN_SUBBAND:-2}"
# Use Espressif ESP32 package, not Heltec package
# The ropg library works with standard ESP32 board definitions
BOARD="esp32:esp32:heltec_wifi_lora_32_V3"
BAUD="115200"

# Build FQBN - Note: LoRaWanBand/SubBand options may not be available
# RadioLib handles region configuration in code, not via board options
FQBN="${BOARD}"

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

# Find arduino-cli and set up PATH
ARDUINO_CLI=""
if ARDUINO_CLI=$(find_arduino_cli); then
    # Add directory to PATH if it's not already there
    ARDUINO_CLI_DIR=$(dirname "$ARDUINO_CLI")
    if [[ ":$PATH:" != *":$ARDUINO_CLI_DIR:"* ]]; then
        export PATH="$ARDUINO_CLI_DIR:$PATH"
    fi
else
    err "arduino-cli not found. Run ./setup_build_env.sh first to install it."
fi

# Verify arduino-cli is executable
if [ ! -x "$ARDUINO_CLI" ]; then
    err "arduino-cli found but not executable: $ARDUINO_CLI"
fi

# --- Helpers ---
log()  { echo -e "\033[0;36m→\033[0m $1"; }
ok()   { echo -e "\033[0;32m✓\033[0m $1"; }
err()  { echo -e "\033[0;31m✗\033[0m $1" >&2; exit 1; }

get_port() {
    local port="${1:-}"
    if [[ -n "$port" ]]; then
        echo "$port"
    else
        "$ARDUINO_CLI" board list 2>/dev/null | awk '/USB|ACM/{print $1; exit}'
    fi
}

check_secrets() {
    local sketch_dir="${1:-.}"
    if [[ ! -f "$sketch_dir/secrets.h" ]]; then
        if [[ -f "$sketch_dir/secrets.example.h" ]]; then
            err "Missing secrets.h - run: cp $sketch_dir/secrets.example.h $sketch_dir/secrets.h"
        fi
    fi
}

# --- Commands ---
cmd_build() {
    local sketch="${1:-.}"
    [[ -d "$sketch" ]] || err "Sketch directory not found: $sketch"
    check_secrets "$sketch"
    
    log "Building $sketch (${LORAWAN_REGION}, sub-band ${LORAWAN_SUBBAND})..."
    "$ARDUINO_CLI" compile --fqbn "$FQBN" "$sketch"
    ok "Build complete"
}

cmd_upload() {
    local sketch="${1:-.}"
    local port=$(get_port "${2:-}")
    [[ -n "$port" ]] || err "No board found. Connect device or specify port."
    
    log "Uploading $sketch to $port..."
    "$ARDUINO_CLI" upload -p "$port" --fqbn "$FQBN" "$sketch"
    ok "Upload complete"
}

cmd_flash() {
    local sketch="${1:-.}"
    local port="${2:-}"
    cmd_build "$sketch"
    cmd_upload "$sketch" "$port"
}

cmd_monitor() {
    local port=$(get_port "${1:-}")
    [[ -n "$port" ]] || err "No board found. Connect device or specify port."
    
    log "Opening serial monitor on $port at ${BAUD} baud..."
    log "Press Ctrl+C to exit"
    "$ARDUINO_CLI" monitor -p "$port" -c baudrate=$BAUD
}

# --- Main ---
ACTION="${1:-}"
shift || true

case "$ACTION" in
    build)   cmd_build "$@" ;;
    upload)  cmd_upload "$@" ;;
    flash)   cmd_flash "$@" ;;
    monitor) cmd_monitor "$@" ;;
    *)
        echo "Usage: $0 {build|upload|flash|monitor} [sketch] [port]"
        echo ""
        echo "Commands:"
        echo "  build [sketch]         Compile sketch"
        echo "  upload [sketch] [port] Upload to device"
        echo "  flash [sketch] [port]  Build and upload"
        echo "  monitor [port]         Serial monitor"
        echo ""
        echo "Environment:"
        echo "  LORAWAN_REGION=$LORAWAN_REGION"
        echo "  LORAWAN_SUBBAND=$LORAWAN_SUBBAND"
        exit 1
        ;;
esac
