#!/bin/bash
set -euo pipefail

# IntelMap VPS Install Script
# Run as root on a fresh Ubuntu 24.04 server

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

INSTALL_DIR="/opt/intelmap"
TARBALL="intelmap.tar.gz"

if [ ! -f "$TARBALL" ]; then
    echo "Error: $TARBALL not found in current directory"
    exit 1
fi

echo "========================================="
echo "  IntelMap VPS Installer"
echo "  Target: intelmap.no"
echo "========================================="
echo ""

# Prompt for configuration
read -rp "Enter your ANTHROPIC_API_KEY: " API_KEY
if [ -z "$API_KEY" ]; then
    echo "Error: API key cannot be empty"
    exit 1
fi

read -rp "Enter your email for SSL certificate: " SSL_EMAIL
if [ -z "$SSL_EMAIL" ]; then
    echo "Error: Email cannot be empty"
    exit 1
fi

echo ""
echo "[1/10] Installing system packages..."
apt update
apt install -y curl nginx certbot python3-certbot-nginx

echo ""
echo "[2/10] Installing Node.js 20..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
else
    echo "Node.js already installed: $(node --version)"
fi

echo ""
echo "[3/10] Creating application user..."
if ! id intelmap &>/dev/null; then
    useradd -r -s /bin/false intelmap
    echo "User 'intelmap' created"
else
    echo "User 'intelmap' already exists"
fi

echo ""
echo "[4/10] Extracting application..."
mkdir -p "$INSTALL_DIR"
tar -xzf "$TARBALL" -C "$INSTALL_DIR"

echo ""
echo "[5/10] Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
npm ci --omit=dev

echo ""
echo "[6/10] Setting up data directory..."
mkdir -p "$INSTALL_DIR/backend/data"

echo ""
echo "[7/10] Writing environment file..."
cat > "$INSTALL_DIR/.env" <<EOF
ANTHROPIC_API_KEY=$API_KEY
CLAUDE_MODEL=claude-sonnet-4-5-20250929
PORT=3001
DATA_DIR=/opt/intelmap/backend/data
EOF

echo ""
echo "[8/10] Setting permissions..."
chown -R intelmap:intelmap "$INSTALL_DIR"

echo ""
echo "[9/10] Configuring systemd service..."
cp "$INSTALL_DIR/intelmap.service" /etc/systemd/system/intelmap.service
systemctl daemon-reload
systemctl enable intelmap
systemctl start intelmap

echo ""
echo "[10/10] Configuring nginx..."
cp "$INSTALL_DIR/nginx/intelmap.conf" /etc/nginx/sites-available/intelmap.conf
ln -sf /etc/nginx/sites-available/intelmap.conf /etc/nginx/sites-enabled/intelmap.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo ""
echo "Setting up SSL certificate..."
certbot --nginx -d intelmap.no --non-interactive --agree-tos --email "$SSL_EMAIL"

echo ""
echo "Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "========================================="
echo "  Installation Complete!"
echo "========================================="
echo ""
systemctl status intelmap --no-pager
echo ""
echo "IntelMap is running at: https://intelmap.no"
echo ""
echo "Useful commands:"
echo "  systemctl status intelmap    - Check service status"
echo "  journalctl -u intelmap -f    - View live logs"
echo "  systemctl restart intelmap   - Restart backend"
