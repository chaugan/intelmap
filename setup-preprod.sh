#!/bin/bash
set -euo pipefail

# IntelMap Preprod - One-Time Setup Script
# Usage: sudo ./setup-preprod.sh <CF_API_TOKEN> <CF_ZONE_ID> <SSL_EMAIL>
# Run as root on the VPS.

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

if [ "$#" -ne 3 ]; then
    echo "Usage: sudo $0 <CF_API_TOKEN> <CF_ZONE_ID> <SSL_EMAIL>"
    exit 1
fi

CF_API_TOKEN="$1"
CF_ZONE_ID="$2"
SSL_EMAIL="$3"

PREPROD_DIR="/opt/intelmap-preprod"
PROD_DIR="/opt/intelmap"
REPO_URL="https://github.com/$(cd "$PROD_DIR" && git remote get-url origin | sed 's|.*github.com[:/]||;s|\.git$||')"
VPS_IP="46.225.127.163"

echo "=== IntelMap Preprod Setup ==="
echo ""

# ---------------------------------------------------------------
# Step 1: Cloudflare DNS
# ---------------------------------------------------------------
echo "[1/10] Creating Cloudflare DNS record for preprod.intelmap.no..."

# Check if record already exists
EXISTING=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=A&name=preprod.intelmap.no" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

RECORD_COUNT=$(echo "$EXISTING" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('result',[])))" 2>/dev/null || echo "0")

if [ "$RECORD_COUNT" -gt "0" ]; then
    # Update existing record
    RECORD_ID=$(echo "$EXISTING" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])")
    curl -s -X PUT \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${RECORD_ID}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"A\",\"name\":\"preprod.intelmap.no\",\"content\":\"${VPS_IP}\",\"ttl\":1,\"proxied\":true}" \
        | python3 -c "import sys,json; r=json.load(sys.stdin); print('  Updated:', r.get('success'))"
else
    # Create new record
    curl -s -X POST \
        "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" \
        --data "{\"type\":\"A\",\"name\":\"preprod.intelmap.no\",\"content\":\"${VPS_IP}\",\"ttl\":1,\"proxied\":true}" \
        | python3 -c "import sys,json; r=json.load(sys.stdin); print('  Created:', r.get('success'))"
fi

echo "  Waiting 30s for DNS propagation..."
sleep 30

# ---------------------------------------------------------------
# Step 2: Clone repo
# ---------------------------------------------------------------
echo ""
echo "[2/10] Cloning repository to ${PREPROD_DIR}..."

if [ -d "$PREPROD_DIR" ]; then
    echo "  Directory already exists, pulling latest instead..."
    cd "$PREPROD_DIR"
    git config --global --add safe.directory "$PREPROD_DIR"
    git fetch origin main
    git reset --hard origin/main
else
    git clone "$REPO_URL" "$PREPROD_DIR"
    git config --global --add safe.directory "$PREPROD_DIR"
fi

# ---------------------------------------------------------------
# Step 3: Create directories
# ---------------------------------------------------------------
echo ""
echo "[3/10] Creating data directories..."
mkdir -p "$PREPROD_DIR/backend/data"
mkdir -p /var/lib/intelmap-preprod/timelapse/exports

# ---------------------------------------------------------------
# Step 4: Write .env
# ---------------------------------------------------------------
echo ""
echo "[4/10] Writing .env file..."
SESSION_SECRET=$(openssl rand -hex 32)
cat > "$PREPROD_DIR/.env" <<EOF
PORT=3002
DATA_DIR=${PREPROD_DIR}/backend/data
SESSION_SECRET=${SESSION_SECRET}
EOF
echo "  .env created with PORT=3002"

# ---------------------------------------------------------------
# Step 5: Install backend dependencies
# ---------------------------------------------------------------
echo ""
echo "[5/10] Installing backend dependencies..."

# Ensure build dependencies for native modules
if ! command -v python3 &>/dev/null || ! command -v make &>/dev/null || ! command -v g++ &>/dev/null; then
    apt install -y python3 make g++
fi

cd "$PREPROD_DIR/backend"
npm ci --omit=dev

# ---------------------------------------------------------------
# Step 6: Copy places.json from prod if available
# ---------------------------------------------------------------
echo ""
echo "[6/10] Setting up places.json..."
PLACES_FILE="$PREPROD_DIR/backend/data/places.json"
PROD_PLACES="$PROD_DIR/backend/data/places.json"

if [ -f "$PROD_PLACES" ]; then
    echo "  Copying from production..."
    cp "$PROD_PLACES" "$PLACES_FILE"
elif [ ! -f "$PLACES_FILE" ]; then
    echo "  Downloading Kartverket place names (one-time, may take a few minutes)..."
    cd "$PREPROD_DIR/backend"
    node src/db/download-places.js
fi

# ---------------------------------------------------------------
# Step 7: Build frontend
# ---------------------------------------------------------------
echo ""
echo "[7/10] Building frontend..."
cd "$PREPROD_DIR/frontend"
npm ci --omit=dev
npx vite build

# ---------------------------------------------------------------
# Step 8: Set permissions
# ---------------------------------------------------------------
echo ""
echo "[8/10] Setting permissions..."
chown -R intelmap:intelmap "$PREPROD_DIR"
chown -R intelmap:intelmap /var/lib/intelmap-preprod

# ---------------------------------------------------------------
# Step 9: Systemd service
# ---------------------------------------------------------------
echo ""
echo "[9/10] Setting up systemd service..."
cp "$PREPROD_DIR/intelmap-preprod.service" /etc/systemd/system/intelmap-preprod.service
systemctl daemon-reload
systemctl enable intelmap-preprod
systemctl start intelmap-preprod

echo "  Service started. Waiting 3s for backend to initialize..."
sleep 3
systemctl status intelmap-preprod --no-pager || true

# ---------------------------------------------------------------
# Step 10: Nginx + SSL
# ---------------------------------------------------------------
echo ""
echo "[10/10] Configuring Nginx and SSL..."
cp "$PREPROD_DIR/nginx/intelmap-preprod.conf" /etc/nginx/sites-available/intelmap-preprod.conf
ln -sf /etc/nginx/sites-available/intelmap-preprod.conf /etc/nginx/sites-enabled/intelmap-preprod.conf
nginx -t && systemctl reload nginx

# Install certbot if not available
if ! command -v certbot &>/dev/null; then
    apt install -y certbot python3-certbot-nginx
fi

echo "  Requesting SSL certificate..."
certbot --nginx -d preprod.intelmap.no --non-interactive --agree-tos -m "$SSL_EMAIL"

echo ""
echo "=== Preprod Setup Complete ==="
echo "  URL: https://preprod.intelmap.no"
echo "  Service: systemctl status intelmap-preprod"
echo "  Deploy: sudo /opt/intelmap/sync-preprod.sh"
echo ""
echo "Note: No database exists yet. Run sync-preprod.sh with DB sync to copy production data."
