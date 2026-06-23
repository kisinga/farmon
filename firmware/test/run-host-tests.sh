#!/usr/bin/env bash
# Host tests for the pure firmware codecs (no ESP32 / esphome needed). Compiles the
# real component sources with g++ against the OpenSSL-backed mbedtls shim.
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

CXXFLAGS="-std=c++17 -Wall -Wextra -O1"

echo "== wire codec =="
g++ $CXXFLAGS \
  -I firmware/components/maji_coord \
  -I firmware/test/host \
  firmware/components/maji_coord/wire.cpp \
  firmware/test/host/mbedtls_shim.cpp \
  firmware/test/wire_test.cpp \
  -lcrypto -o "$OUT/wire_test"
"$OUT/wire_test"

echo
echo "== control kernel =="
g++ $CXXFLAGS \
  -I firmware/components/maji_control \
  firmware/components/maji_control/core.cpp \
  firmware/test/core_test.cpp \
  -o "$OUT/core_test"
"$OUT/core_test"

echo
echo "== meter kernel =="
g++ $CXXFLAGS \
  -I firmware/components/maji_control \
  firmware/components/maji_control/core.cpp \
  firmware/components/maji_control/meter.cpp \
  firmware/test/meter_test.cpp \
  -o "$OUT/meter_test"
"$OUT/meter_test"

echo
echo "== automation kernel =="
g++ $CXXFLAGS \
  -I firmware/components/maji_automations \
  firmware/components/maji_automations/core.cpp \
  firmware/test/automation_test.cpp \
  -o "$OUT/automation_test"
"$OUT/automation_test"

echo
echo "All host tests passed."
