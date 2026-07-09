#!/bin/sh
# Verify why a fault WhatsApp alert was not sent.
# Run inside the maji-server container:
#   docker cp scripts/verify-fault-alert.sh <container>:/tmp/verify.sh
#   docker exec <container> sh /tmp/verify.sh

DB=${DB_PATH:-/pb_data/data.db}

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 not found; installing temporarily..."
  apk add --no-cache sqlite >/dev/null 2>&1 || { echo "Failed to install sqlite3"; exit 1; }
fi

if [ ! -f "$DB" ]; then
  echo "DB not found at $DB"
  exit 1
fi

echo "=== OPENWA ENV ==="
env | grep '^MAJI_OPENWA' || echo "(none set)"

echo ""
echo "=== SITES ==="
sqlite3 "$DB" "SELECT id, name, owner FROM sites;"

echo ""
echo "=== USERS ==="
sqlite3 "$DB" "SELECT id, email, phone FROM users;"

echo ""
echo "=== NOTIFICATION PREFS ==="
sqlite3 "$DB" "SELECT user, alert_fault, channel_whatsapp, whatsapp_chat_id, whatsapp_country_code FROM notification_prefs;"

echo ""
echo "=== RECENT FAULT TRANSITIONS (state_events) ==="
sqlite3 "$DB" "SELECT site, controller, route, from_state, to_state, reason, ts FROM state_events WHERE to_state = 'FAULT' ORDER BY ts DESC LIMIT 20;"

echo ""
echo "=== FAULT INCIDENTS (notification_incidents) ==="
sqlite3 "$DB" "SELECT site, incident_key, kind, status, first_seen, last_seen, last_sent FROM notification_incidents WHERE kind = 'fault' ORDER BY last_seen DESC LIMIT 20;"
