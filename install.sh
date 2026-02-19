#!/bin/bash
set -euo pipefail

# IntelMap VPS Install Script
# Run as root on a fresh Ubuntu 24.04 server
# Usage: curl -O https://raw.githubusercontent.com/chaugan/intelmap/main/install.sh
#        chmod +x install.sh && sudo ./install.sh

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This script must be run as root"
    exit 1
fi

INSTALL_DIR="/opt/intelmap"
REPO="https://github.com/chaugan/intelmap.git"

echo "========================================="
echo "  IntelMap VPS Installer"
echo "  Target: intelmap.no"
echo "========================================="
echo ""

# Prompt for SSL email
read -rp "Enter your email for SSL certificate: " SSL_EMAIL
if [ -z "$SSL_EMAIL" ]; then
    echo "Error: Email cannot be empty"
    exit 1
fi

echo ""
echo "[1/11] Installing system packages..."
apt update
apt install -y curl git nginx certbot python3-certbot-nginx python3 make g++

echo ""
echo "[2/11] Installing Node.js 20..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
else
    echo "Node.js already installed: $(node --version)"
fi

echo ""
echo "[3/11] Creating application user..."
if ! id intelmap &>/dev/null; then
    useradd -r -s /bin/false intelmap
    echo "User 'intelmap' created"
else
    echo "User 'intelmap' already exists"
fi

echo ""
echo "[4/11] Cloning repository..."
if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Repository already exists, pulling latest..."
    cd "$INSTALL_DIR"
    git pull origin main
else
    rm -rf "$INSTALL_DIR"
    git clone "$REPO" "$INSTALL_DIR"
fi

echo ""
echo "[5/11] Installing backend dependencies..."
cd "$INSTALL_DIR/backend"
npm ci --omit=dev

echo ""
echo "[6/11] Building frontend..."
cd "$INSTALL_DIR/frontend"
npm ci
npx vite build

echo ""
echo "[7/11] Setting up data directory..."
mkdir -p "$INSTALL_DIR/backend/data"

echo ""
echo "[8/11] Writing environment file..."
SESSION_SECRET=$(openssl rand -hex 32)
cat > "$INSTALL_DIR/.env" <<EOF
ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-sonnet-4-5-20250929
PORT=3001
DATA_DIR=/opt/intelmap/backend/data
SESSION_SECRET=$SESSION_SECRET
EOF

echo ""
echo "[9/11] Setting permissions..."
chown -R intelmap:intelmap "$INSTALL_DIR"

echo ""
echo "[10/11] Configuring systemd service..."
cp "$INSTALL_DIR/intelmap.service" /etc/systemd/system/intelmap.service
systemctl daemon-reload
systemctl enable intelmap
systemctl start intelmap

echo ""
echo "[11/11] Configuring nginx..."
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
echo "NOTE: Set your ANTHROPIC_API_KEY via the admin panel."
echo ""
echo "Useful commands:"
echo "  systemctl status intelmap    - Check service status"
echo "  journalctl -u intelmap -f    - View live logs"
echo "  systemctl restart intelmap   - Restart backend"
echo "  /opt/intelmap/sync.sh        - Pull & deploy updates"
