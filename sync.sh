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

echo "[1/7] Pulling latest from GitHub..."
cd "$INSTALL_DIR"
git config --global --add safe.directory "$INSTALL_DIR"
git fetch origin main
git reset --hard origin/main

echo ""
echo "[2/7] Self-updating sync script..."
cp "$INSTALL_DIR/sync.sh" /opt/intelmap/sync.sh
chmod +x /opt/intelmap/sync.sh

echo ""
echo "[3/7] Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
npm ci --omit=dev

echo ""
echo "[4/7] Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci
npx vite build

echo ""
echo "[5/7] Updating config files..."
cp "$INSTALL_DIR/nginx/intelmap.conf" /etc/nginx/sites-available/intelmap.conf
cp "$INSTALL_DIR/intelmap.service" /etc/systemd/system/intelmap.service
systemctl daemon-reload
nginx -t && systemctl reload nginx

echo ""
echo "[6/7] Setting permissions..."
chown -R intelmap:intelmap "$INSTALL_DIR"

echo ""
echo "[7/7] Restarting backend..."
systemctl restart intelmap

echo ""
echo "=== Sync Complete ==="
systemctl status intelmap --no-pager
