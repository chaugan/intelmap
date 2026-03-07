#!/bin/bash
set -euo pipefail

# IntelMap Preprod Deploy Script
# Deploys latest code to preprod, optionally syncs production database.
# Run as root from the prod repo: sudo /opt/intelmap/sync-preprod.sh

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

PREPROD_DIR="/opt/intelmap-preprod"
PROD_DIR="/opt/intelmap"

if [ ! -d "$PREPROD_DIR" ]; then
    echo "Error: Preprod directory not found at $PREPROD_DIR"
    echo "Run setup-preprod.sh first."
    exit 1
fi

echo "=== IntelMap Preprod Deploy ==="
echo ""

# Ensure build dependencies for native modules
if ! command -v python3 &>/dev/null || ! command -v make &>/dev/null || ! command -v g++ &>/dev/null; then
    echo "[0/7] Installing build dependencies..."
    apt install -y python3 make g++
fi

echo "[1/7] Pulling latest into preprod..."
cd "$PREPROD_DIR"
git config --global --add safe.directory "$PREPROD_DIR"
git fetch origin main
git reset --hard origin/main

echo ""
echo "[2/7] Installing backend dependencies..."
cd "$PREPROD_DIR/backend"
npm ci --omit=dev

echo ""
echo "[3/7] Downloading place names (if needed)..."
PLACES_FILE="$PREPROD_DIR/backend/data/places.json"
if [ ! -f "$PLACES_FILE" ]; then
    PROD_PLACES="$PROD_DIR/backend/data/places.json"
    if [ -f "$PROD_PLACES" ]; then
        echo "  Copying from production..."
        cp "$PROD_PLACES" "$PLACES_FILE"
    else
        echo "  Downloading Kartverket place names (one-time, may take a few minutes)..."
        cd "$PREPROD_DIR/backend"
        mkdir -p data
        node src/db/download-places.js
    fi
    chown intelmap:intelmap "$PLACES_FILE"
else
    echo "  places.json already exists, skipping."
fi

echo ""
echo "[4/7] Building frontend..."
cd "$PREPROD_DIR/frontend"
npm ci --omit=dev
npx vite build

echo ""
echo "[5/7] Updating config files..."
cp "$PREPROD_DIR/nginx/intelmap-preprod.conf" /etc/nginx/sites-available/intelmap-preprod.conf
cp "$PREPROD_DIR/intelmap-preprod.service" /etc/systemd/system/intelmap-preprod.service
systemctl daemon-reload
nginx -t && systemctl reload nginx

echo ""
echo "[6/7] Setting permissions..."
chown -R intelmap:intelmap "$PREPROD_DIR"

echo ""
echo "[7/7] Restarting preprod backend..."
systemctl restart intelmap-preprod

echo ""
echo "=== Deploy Complete ==="
systemctl status intelmap-preprod --no-pager || true

echo ""
# ---------------------------------------------------------------
# Optional: Database sync from production
# ---------------------------------------------------------------
read -rp "Sync production database to preprod? (y/N): " SYNC_DB

if [[ "$SYNC_DB" =~ ^[Yy]$ ]]; then
    echo ""
    echo "--- Syncing production database to preprod ---"

    PROD_DB="$PROD_DIR/backend/data/intelmap.db"
    PREPROD_DB="$PREPROD_DIR/backend/data/intelmap.db"

    if [ ! -f "$PROD_DB" ]; then
        echo "Error: Production database not found at $PROD_DB"
        exit 1
    fi

    echo "  Stopping preprod service..."
    systemctl stop intelmap-preprod

    mkdir -p "$PREPROD_DIR/backend/data"

    if command -v sqlite3 &>/dev/null; then
        echo "  Backing up database using sqlite3 .backup (WAL-safe)..."
        sqlite3 "$PROD_DB" ".backup '${PREPROD_DB}'"
    else
        echo "  sqlite3 not found, falling back to file copy..."
        cp "$PROD_DB" "$PREPROD_DB"
        [ -f "${PROD_DB}-shm" ] && cp "${PROD_DB}-shm" "${PREPROD_DB}-shm"
        [ -f "${PROD_DB}-wal" ] && cp "${PROD_DB}-wal" "${PREPROD_DB}-wal"
    fi

    chown intelmap:intelmap "$PREPROD_DIR/backend/data/"intelmap.db*

    # Write sync timestamp for the preprod UI banner
    date -Iseconds > "$PREPROD_DIR/backend/data/.last-db-sync"
    chown intelmap:intelmap "$PREPROD_DIR/backend/data/.last-db-sync"

    echo "  Starting preprod service..."
    systemctl start intelmap-preprod

    echo ""
    echo "Database synced from production to preprod."
else
    echo "Preprod keeps its existing database."
fi

echo ""
echo "Preprod available at: https://preprod.intelmap.no"
