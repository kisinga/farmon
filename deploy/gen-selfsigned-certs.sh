#!/bin/sh
# Generate a self-signed MQTT TLS chain for the device-facing 8883 listener.
#
# Two-tier: a long-lived local CA signs a server leaf for the broker hostname.
# The CA cert (ca.pem) is the trust anchor that clients/firmware embed; rotating
# the server leaf later never invalidates it (no re-flash of field devices).
#
# Usage:  deploy/gen-selfsigned-certs.sh [hostname]   (default: mqtt.majiflow.io)
#
# Outputs into deploy/certs/ (git-ignored):
#   privkey.pem   - server private key   -> broker MAJI_MQTT_TLS_KEY
#   fullchain.pem - server cert + CA     -> broker MAJI_MQTT_TLS_CERT
#   ca.pem        - CA cert; trust THIS on clients (mosquitto_sub --cafile ca.pem,
#                   and the value to embed as the firmware certificate_authority)
set -eu

MQTT_HOST="${1:-mqtt.majiflow.io}"
DIR="$(cd "$(dirname "$0")/certs" && pwd)"
# CA = the trust anchor embedded in firmware: long-lived so it ~never changes.
# Keep ca-key.pem OFFLINE (never on the server / in git) and back it up.
DAYS_CA=10950   # ~30 yr
# Leaf = the broker's server cert: re-issue from the CA anytime, no device re-flash.
DAYS_LEAF=3650  # ~10 yr

# 1) Local CA (self-signed root).
openssl req -x509 -newkey rsa:2048 -sha256 -days "$DAYS_CA" -nodes \
  -keyout "$DIR/ca-key.pem" -out "$DIR/ca.pem" \
  -subj "/CN=MajiFlow Self-Signed CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

# 2) Server key + CSR for the broker hostname.
openssl req -newkey rsa:2048 -sha256 -nodes \
  -keyout "$DIR/privkey.pem" -out "$DIR/server.csr" \
  -subj "/CN=$MQTT_HOST"

# 3) Sign the leaf with the CA, carrying SAN + serverAuth EKU.
EXT="$(mktemp)"
cat > "$EXT" <<EOF
subjectAltName=DNS:$MQTT_HOST
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -in "$DIR/server.csr" -CA "$DIR/ca.pem" -CAkey "$DIR/ca-key.pem" \
  -CAcreateserial -days "$DAYS_LEAF" -sha256 -extfile "$EXT" -out "$DIR/server.pem"
rm -f "$EXT"

# 4) fullchain = leaf + CA (what the broker serves).
cat "$DIR/server.pem" "$DIR/ca.pem" > "$DIR/fullchain.pem"

# Tidy intermediates (keep ca-key.pem so you can re-issue leaves later).
rm -f "$DIR/server.csr" "$DIR/server.pem" "$DIR/ca.srl"

echo "Wrote for $MQTT_HOST:"
echo "  $DIR/privkey.pem    (broker key)"
echo "  $DIR/fullchain.pem  (broker cert chain)"
echo "  $DIR/ca.pem         (trust anchor for clients/firmware)"
