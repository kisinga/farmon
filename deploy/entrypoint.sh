#!/bin/sh
# maji-server container entrypoint.
#
# Bootstraps the PocketBase superuser (the /_/ dashboard login) from env when
# provided, then serves. The superuser is distinct from the app-level admin
# login, which maji-server seeds from MAJI_ADMIN_EMAIL/MAJI_ADMIN_PASSWORD on
# startup. `superuser upsert` is idempotent, so this is safe on every boot.
set -e

PB_DIR=/pb_data

if [ -n "$MAJI_SUPERUSER_EMAIL" ] && [ -n "$MAJI_SUPERUSER_PASSWORD" ]; then
  maji-cloud superuser upsert "$MAJI_SUPERUSER_EMAIL" "$MAJI_SUPERUSER_PASSWORD" --dir="$PB_DIR"
fi

# Bind all interfaces (container networking) and keep all state on the volume.
exec maji-cloud serve --http=0.0.0.0:8090 --dir="$PB_DIR"
