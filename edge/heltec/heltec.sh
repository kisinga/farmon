#!/usr/bin/env bash
set -euo pipefail

# This script builds and uploads the specified Arduino sketch.
# Run this from within the edge/heltec directory.
#
# Usage:
#   ./heltec.sh [-v|--verbose] build <sketch_name>
#   ./heltec.sh [-v|--verbose] upload <sketch_name> [port]
#   ./heltec.sh [-v|--verbose] build-upload <sketch_name> [port]
#
# Examples:
#   ./heltec.sh build relay
#   ./heltec.sh -v upload remote                    # Auto-detect port (verbose)
#   ./heltec.sh --verbose upload remote /dev/ttyUSB0 # Manual port (verbose)
#   ./heltec.sh build-upload relay                  # Auto-detect port
#   ./heltec.sh -v build-upload relay /dev/ttyUSB0  # Manual port (verbose)

VERBOSE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -*)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [-v|--verbose] {build|upload|build-upload} <sketch_name> [port]"
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

# Check minimum arguments after parsing options
if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "Usage: $0 [-v|--verbose] {build|upload|build-upload} <sketch_name> [port]"
  exit 1
fi

ACTION=$1
SKETCH_NAME=$2
PORT=${3:-}  # Optional port parameter, empty if not provided

# LoRaWAN Configuration
# Sub-band 2 = channels 8-15 (903.9-905.3 MHz) - must match gateway/concentratord
LORAWAN_REGION="US915"
LORAWAN_SUBBAND="2"
FQBN="Heltec-esp32:esp32:heltec_wifi_lora_32_V3:LoRaWanBand=${LORAWAN_REGION},LoRaWanSubBand=${LORAWAN_SUBBAND}"
SKETCH_DIR="${SKETCH_NAME}"

if [ ! -d "$SKETCH_DIR" ]; then
  echo "Error: Sketch directory not found at '$SKETCH_DIR'"
  exit 1
fi

# Ensure the lib symlink exists
if [ "$VERBOSE" = true ]; then
  echo "Setting up lib symlinks..."
fi
./arduino-include.sh apply $([ "$VERBOSE" = true ] && echo "--verbose")

# Function to get port - uses provided port or auto-detects
get_port() {
    if [ -n "$PORT" ]; then
        echo "$PORT"
        return 0
    fi

    # Auto-detect first available USB port
    local detected_port
    detected_port=$(arduino-cli board list | awk '/USB/{print $1; exit}')
    echo "$detected_port"
}

case "$ACTION" in
  build)
    if [ "$VERBOSE" = true ]; then
      echo "Building sketch '$SKETCH_NAME' for board '$FQBN'..."
      echo "Sketch directory: $SKETCH_DIR"
      echo "Board FQBN: $FQBN"
    fi
    arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"
    echo "Build complete."
    ;;
  upload)
    # Get the serial port (manual or auto-detected)
    if [ "$VERBOSE" = true ]; then
      echo "Detecting serial port..."
    fi
    PORT=$(get_port)

    if [ -z "$PORT" ]; then
        echo "Error: Could not find a connected board. Please ensure it is connected and drivers are installed."
        exit 1
    fi

    if [ "$VERBOSE" = true ]; then
      echo "Found board on port: $PORT"
      echo "Uploading sketch '$SKETCH_NAME' to board '$FQBN' on port $PORT..."
    fi
    arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH_DIR"
    echo "Upload complete."
    ;;
  build-upload)
    if [ "$VERBOSE" = true ]; then
      echo "Building sketch '$SKETCH_NAME' for board '$FQBN'..."
      echo "Sketch directory: $SKETCH_DIR"
      echo "Board FQBN: $FQBN"
    fi
    arduino-cli compile --fqbn "$FQBN" "$SKETCH_DIR"

    # Get the serial port (manual or auto-detected)
    if [ "$VERBOSE" = true ]; then
      echo "Detecting serial port for upload..."
    fi
    PORT=$(get_port)

    if [ -z "$PORT" ]; then
        echo "Error: Could not find a connected board. Please ensure it is connected and drivers are installed."
        exit 1
    fi

    if [ "$VERBOSE" = true ]; then
      echo "Found board on port: $PORT"
      echo "Uploading sketch '$SKETCH_NAME' to board '$FQBN' on port $PORT..."
    fi
    arduino-cli upload -p "$PORT" --fqbn "$FQBN" "$SKETCH_DIR"
    echo "Build and upload complete."
    ;;
  *)
    echo "Error: Invalid action '$ACTION'. Use 'build', 'upload', or 'build-upload'." >&2
    exit 1
    ;;
esac

