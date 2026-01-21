#!/bin/bash
# Quick fix script for Node-RED Dashboard access
# Run this if you're getting "Cannot GET /ui/farm-monitor"

set -e

echo "Installing Node-RED Dashboard package..."
docker exec farm-nodered npm install node-red-dashboard node-red-contrib-postgresql

echo "Copying configuration files..."
docker cp ./nodered/settings.js farm-nodered:/data/settings.js
docker cp ./nodered/flows.json farm-nodered:/data/flows.json

echo "Restarting Node-RED container..."
docker restart farm-nodered

echo ""
echo "Waiting for Node-RED to start..."
sleep 10

echo ""
echo "✓ Dashboard should now be available at:"
echo "  http://<pi-ip>:1880/ui/farm-monitor"
echo ""
echo "If it still doesn't work, check logs:"
echo "  docker logs farm-nodered --tail 50"
