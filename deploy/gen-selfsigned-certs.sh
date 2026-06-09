#!/bin/sh
# Generate a single self-signed TLS cert for the device-facing 8883 broker listener.
#
# ONE self-signed cert (issuer == subject) is BOTH the broker's server cert AND the
# trust anchor the firmware pins. esp-idf mbedTLS rejects a two-tier self-signed CA
# chain (NOT_TRUSTED → handshake -0x2700), but it trusts a self-signed cert it finds
# byte-identical in its store — so devices pin THIS exact cert. CA:TRUE lets mbedTLS
# treat it as its own trust anchor; SAN + serverAuth make it a valid TLS server cert.
#
# Rotating the cert re-flashes the fleet (the device pins it exactly), so it is
# long-lived. The device does not check cert dates (CONFIG_MBEDTLS_HAVE_TIME_DATE is
# off), so expiry never forces a reflash — only a deliberate key rotation does.
#
# Usage:  deploy/gen-selfsigned-certs.sh [hostname]   (default: mqtt.majiflow.io)
#
# Outputs into deploy/certs/ (git-ignored):
#   privkey.pem    - broker private key      -> broker MAJI_MQTT_TLS_KEY
#   fullchain.pem  - the self-signed cert    -> broker MAJI_MQTT_TLS_CERT (the server
#                    also derives the firmware's pinned cert from this file)
#   ca.pem         - identical copy, for client testing (mosquitto_sub --cafile ca.pem)
set -eu

MQTT_HOST="${1:-mqtt.majiflow.io}"
DIR="$(cd "$(dirname "$0")/certs" && pwd)"
DAYS=3650   # ~10 yr; devices ignore expiry, so this only matters to non-device clients

# Single self-signed server cert: issuer == subject, CA:TRUE (so mbedTLS accepts it as
# its own trust anchor), SAN + serverAuth EKU (so it is a valid TLS server leaf).
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS" -nodes \
  -keyout "$DIR/privkey.pem" -out "$DIR/fullchain.pem" \
  -subj "/CN=$MQTT_HOST" \
  -addext "subjectAltName=DNS:$MQTT_HOST" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" \
  -addext "extendedKeyUsage=serverAuth"

cp "$DIR/fullchain.pem" "$DIR/ca.pem"

echo "Wrote for $MQTT_HOST:"
echo "  $DIR/privkey.pem    (broker key)"
echo "  $DIR/fullchain.pem  (broker cert; firmware pins this exact cert)"
echo "  $DIR/ca.pem         (identical copy, for client testing)"
