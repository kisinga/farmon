#!/bin/bash
# Build and flash the LoRa-E5 TinyGo firmware.
# Requires: tinygo, openocd, ST-Link V2 programmer
#
# Usage:
#   ./flash.sh build     # compile only
#   ./flash.sh flash     # compile and flash via ST-Link
#   ./flash.sh size      # show binary size breakdown

set -e

TARGET="lorae5"
ENTRY="./cmd/node"
OUTPUT="build/firmware.elf"

# TinyGo flags optimized for size on STM32WL
TINYGO_FLAGS=(
    -target=$TARGET
    -size=short
    -opt=z
)

case "${1:-build}" in
    build)
        echo "Building for $TARGET..."
        mkdir -p build
        tinygo build "${TINYGO_FLAGS[@]}" -o "$OUTPUT" "$ENTRY"
        echo "Built: $OUTPUT"
        tinygo size "${TINYGO_FLAGS[@]}" "$ENTRY"
        ;;

    flash)
        echo "Flashing to $TARGET via ST-Link..."
        tinygo flash "${TINYGO_FLAGS[@]}" "$ENTRY"
        echo "Done. Device should reboot."
        ;;

    size)
        tinygo size "${TINYGO_FLAGS[@]}" "$ENTRY"
        ;;

    monitor)
        # Serial monitor on the LoRa-E5 UART1 (PB6/PB7)
        # Adjust port as needed
        PORT="${2:-/dev/tty.usbserial-*}"
        echo "Monitoring $PORT at 115200..."
        screen "$PORT" 115200
        ;;

    *)
        echo "Usage: $0 {build|flash|size|monitor}"
        exit 1
        ;;
esac
