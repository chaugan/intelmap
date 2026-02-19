# IntelMap

Military tactical map server for exercises in Norway. Real-time collaborative mapping with AI-powered command interface, NATO symbology, weather intelligence, and Norwegian topographic data.

Live at **[intelmap.no](https://intelmap.no)**

## Features

### Map & Layers

- **Base maps** — Kartverket Topographic, Grayscale, Raster, and OpenStreetMap
- **Wind overlay** — Animated particle visualization with color-coded speed (green → blue → red)
- **Webcam layer** — Live road cameras from Vegvesen across Norway
- **Avalanche zones** — Danger areas from NVE/Varsom
- **Snow depth** — Daily seNorge raster with 8 depth categories (0 cm to 400+ cm)
- **Layer management** — Create, rename, reorder, and toggle custom overlay layers

### NATO Symbology (MIL-STD-2525C)

Full APP-6 military symbol library with friendly, hostile, and neutral affiliations:

Infantry, Armor, Artillery, Air Defense, Aviation, Engineer, Reconnaissance, Logistics, Medical, HQ/Command, Signals, Special Forces, Obstacles (minefields), Naval, CBRN

Each symbol supports unit designation, higher formation, and additional info fields.

### Drawing Tools

- Line, polygon, circle, arrow, freehand, and text
- Solid, dashed, and arrow line styles
- Color selection (blue, red, green, black) with fill opacity
- Box-select and batch delete
- Per-layer assignment

### AI Assistant

Natural language map manipulation powered by Claude:

- Location search and fly-to
- Marker placement with NATO symbols
- Layer creation and management
- Draw lines, polygons, circles, and text labels
- Road routing (Vegvesen road network)
- Cross-country terrain routing with elevation awareness
- Screenshot analysis with coordinate grid overlay
- Streaming responses via Server-Sent Events

### Weather Intelligence

- **Forecast** — Temperature, wind, gusts, clouds, precipitation, humidity, pressure (48h in 3h intervals)
- **Sun & Moon** — Sunrise/sunset times, moon phase
- **Wind chill** — Calculated from temperature and wind speed
- **Snow depth** — Point query at any location

### Projects & Collaboration

- **Multi-project support** — Create, load, and manage separate tactical projects
- **Real-time sync** — All markers, drawings, layers, and pins shared live via Socket.IO
- **Project sharing** — Share projects with groups (admin/editor/viewer roles)
- **Persistent state** — SQLite database with automatic save

### Authentication & Administration

- **User accounts** — Session-based login with 7-day expiration
- **Admin panel** — Create/delete users, reset passwords, promote/demote admins
- **AI access control** — Enable/disable AI chat per user
- **Group management** — Create groups, assign members with roles
- **Security** — bcrypt passwords, rate limiting, account locking, httpOnly cookies

### Internationalization

- Norwegian (default) and English
- Language toggle in the UI

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Toggle wind overlay |
| `C` | Toggle webcams |
| `A` | Toggle avalanche zones |
| `S` | Toggle snow depth |
| `D` | Toggle drawing tools |
| `1` | Layers panel |
| `2` | Symbols panel |
| `3` | Weather panel |
| `4` | Search panel |
| `P` | Projects drawer |
| `I` | AI chat |
| `Esc` | Cancel / close |

## Tech Stack

- **Frontend**: React 19, Vite 7, MapLibre GL JS, Tailwind CSS v4, Zustand
- **Backend**: Express, Socket.IO, SQLite (better-sqlite3), Anthropic Claude SDK
- **APIs**: Kartverket (tiles, search, elevation), MET Norway (weather, sun/moon), Vegvesen (webcams, routing), NVE/Varsom (avalanche), seNorge (snow depth)
- **Deployment**: Docker, nginx, systemd, certbot SSL

## Quick Start

### Docker

```bash
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY
docker compose up --build
```

App runs at `http://localhost:8080`.

### Development

```bash
# Backend
cd backend && npm install && node src/index.js

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Frontend at `http://localhost:5173`, backend at `http://localhost:3001`.

### VPS Deployment

```bash
curl -O https://raw.githubusercontent.com/chaugan/intelmap/main/install.sh
chmod +x install.sh
sudo ./install.sh
```

This installs everything on a fresh Ubuntu 24.04 server: Node.js, nginx, SSL via certbot, systemd service, and firewall rules. Set your API key via the admin panel after install.

Update with:

```bash
sudo /opt/intelmap/sync.sh
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for AI features (set via admin panel or .env) |
| `CLAUDE_MODEL` | Model ID (default: `claude-sonnet-4-5-20250929`) |
| `PORT` | Backend port (default: `3001`) |
| `DATA_DIR` | Persistent data directory (default: `./data`) |
| `SESSION_SECRET` | Secret for session cookies (auto-generated on install) |

## License

[MIT](LICENSE)
