#!/bin/bash
set -euo pipefail

# IntelMap Sync Script
# Pulls latest changes from GitHub and restarts services.
# Run as root on the VPS: sudo /opt/intelmap/sync.sh

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

INSTALL_DIR="/opt/intelmap"

echo "=== IntelMap Sync ==="
echo ""

# Ensure build dependencies for native modules
if ! command -v python3 &>/dev/null || ! command -v make &>/dev/null || ! command -v g++ &>/dev/null; then
    echo "[0/7] Installing build dependencies..."
    apt install -y python3 make g++
fi

# Ensure FFmpeg is installed for timelapse feature
if ! command -v ffmpeg &>/dev/null; then
    echo "[0/7] Installing FFmpeg..."
    apt install -y ffmpeg
fi

echo "[1/8] Pulling latest from GitHub..."
cd "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR"
git fetch origin main
git reset --hard origin/main

echo ""
echo "[2/8] Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
npm ci --omit=dev

echo ""
echo "[3/8] Downloading place names (if needed)..."
PLACES_FILE="$INSTALL_DIR/backend/data/places.json"
if [ ! -f "$PLACES_FILE" ]; then
    echo "  Downloading Kartverket place names (one-time, may take a few minutes)..."
    cd "$INSTALL_DIR/backend"
    mkdir -p data
    node src/db/download-places.js
    chown intelmap:intelmap "$PLACES_FILE"
else
    echo "  places.json already exists, skipping download."
fi

echo ""
echo "[4/8] Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci --omit=dev
npx vite build

echo ""
echo "[5/8] Updating config files..."
cp "$INSTALL_DIR/nginx/intelmap.conf" /etc/nginx/sites-available/intelmap.conf
cp "$INSTALL_DIR/intelmap.service" /etc/systemd/system/intelmap.service
systemctl daemon-reload
nginx -t && systemctl reload nginx

echo ""
echo "[6/8] Setting permissions..."
chown -R intelmap:intelmap "$INSTALL_DIR"

echo ""
echo "[7/8] Creating timelapse directories..."
mkdir -p /var/lib/intelmap/timelapse/exports
chown -R intelmap:intelmap /var/lib/intelmap/timelapse

echo ""
echo "[8/8] Restarting backend..."
systemctl restart intelmap

echo ""
echo "=== Sync Complete ==="
systemctl status intelmap --no-pager
