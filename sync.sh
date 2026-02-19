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
    echo "[0/6] Installing build dependencies..."
    apt install -y python3 make g++
fi

echo "[1/6] Pulling latest from GitHub..."
cd "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR"
git fetch origin main
git reset --hard origin/main

echo ""
echo "[2/6] Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
npm ci --omit=dev

echo ""
echo "[3/6] Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci
npx vite build

echo ""
echo "[4/6] Updating config files..."
cp "$INSTALL_DIR/nginx/intelmap.conf" /etc/nginx/sites-available/intelmap.conf
cp "$INSTALL_DIR/intelmap.service" /etc/systemd/system/intelmap.service
systemctl daemon-reload
nginx -t && systemctl reload nginx

echo ""
echo "[5/6] Setting permissions..."
chown -R intelmap:intelmap "$INSTALL_DIR"

echo ""
echo "[6/6] Restarting backend..."
systemctl restart intelmap

echo ""
echo "=== Sync Complete ==="
systemctl status intelmap --no-pager
