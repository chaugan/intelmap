# IntelMap

A real-time collaborative tactical map platform with AI-powered command interface, NATO symbology, advanced terrain analysis tools, and deep integration with Norwegian geographic data sources.

Live at **[intelmap.no](https://intelmap.no)**

## Features

### Base Maps & Terrain

- **Norwegian topographic maps** — Kartverket Topo, Grayscale, Raster, and OpenStreetMap variants
- **3D buildings** — Extruded building layer with adjustable opacity and sky/stars rendering
- **Hillshade & terrain** — Terrain shading with 3D exaggeration (1-3x)
- **Layer z-order** — Drag-reorder overlays when multiple are active

### Data Layers

- **Wind overlay** — Animated particle visualization with color-coded speed
- **Webcam layer** — Live road cameras from Statens Vegvesen across Norway
- **Avalanche terrain** — Danger zones from NVE/Varsom
- **Avalanche warnings** — Color-coded forecast regions (5 danger levels) with day picker, detailed panel with avalanche problems, mountain weather, and aspect/elevation data
- **Snow depth** — Daily seNorge raster with 8 depth categories (0 cm to 400+ cm)
- **Aircraft tracking** — Real-time ADS-B aviation overlay with focus/filter capability
- **Vessel tracking** — Real-time AIS maritime tracking with vessel categorization, deep analysis (stop detection, historical traces, speed analysis), time travel reconstruction, and box-based activity analysis
- **Traffic flow** — Real-time traffic movement visualization
- **Traffic info** — Incidents and alerts (accidents, roadwork, weather) with category filtering
- **Road restrictions** — Weight and height limitations from NVDB, color-coded by severity, with sticky popups, municipality names, and pulsation highlight toggle
- **Infrastructure layer** — Critical infrastructure data with search filtering
- **Aurora / northern lights** — KP index visualization with 4-hour time offset options
- **Sunlight / daylight** — Day/night shadow overlay with date/time controls and animation

### Context Menu (Right-Click)

Right-click anywhere on the map for point intelligence:

- Coordinates (lat/lon + MGRS/UTM), elevation, place name
- Current weather (temperature, wind, gusts, wind chill, snow depth, conditions, moon phase)
- Avalanche danger level for the clicked region
- Google Street View preview with 360° rotation (where available)
- Pin context menus to the map, auto-refresh weather every 5 minutes

### NATO Symbology (MIL-STD-2525C)

Full APP-6 military symbol library with friendly, hostile, and neutral affiliations:

Infantry, Armor, Artillery, Air Defense, Aviation, Engineer, Reconnaissance, Logistics, Medical, HQ/Command, Signals, Special Forces, Obstacles, Naval, CBRN

Each symbol supports unit designation, higher formation, and additional info fields. Automatic declutter algorithm spreads overlapping symbols.

### Drawing Tools

- **Line, arrow, polygon, circle, ellipse, sector** — Full shape toolkit with color selection and fill opacity
- **Sector / fan tool** — 3-click wedge shapes for observation sectors and fields of fire
- **Text labels** — Adjustable font size
- **Needle / pin markers** — Point markers with optional labels
- **Markdown notes** — Rich text notes anchored to map rectangles with live editing
- **CSV import** — Batch import geometries from CSV files
- **Vertex editing** — Drag handles to reshape any drawing after creation
- **Box-select & batch delete** — Select and manage multiple drawings at once
- **Per-layer assignment** — Organize drawings into custom layers

### Analysis Tools

- **Measurement tool** — Route distance measurement with 3D elevation profile graph
- **Grid tool** — Customizable grid overlay with lettered columns, numbered rows, and area calculation
- **Viewshed analysis** — Line-of-sight visibility calculation from any point
- **RF coverage analysis** — Radio propagation modeling with configurable antenna height, transmit power, frequency, and radius (up to 75 km), including terrain-aware signal strength and reflection modeling
- **Firing range analyzer** — Artillery and ballistic range calculator with weapon presets
- **Inverse vulnerability analyzer** — Reverse analysis: determine what can reach a given target position

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

### Fire Report

8-field fire support request form:

- Fields A-H with persistent history
- Geometry options (point, area, line, custom)
- Support types (AD, CAS, ROC, GUN, MRT)
- MGRS coordinate resolution and time priority

### Export & Integration

- **Screenshot export** — PNG capture with timestamped filename
- **WaSOS upload** — Direct export to military situational awareness system
- **Signal upload** — Export screenshots to Signal messenger
- **Security markings** — Configurable classification labels on exports

### GPS & Location

- **Continuous GPS tracking** — Toggle on/off, tracks user position in real-time with pulsing marker
- **Fly-to on first fix** — Automatically centers map on user location

### Timelapse & Monitoring

- **Timelapse camera system** — Record, scrub, and export time-lapses from road cameras with timeline slider and MP4 export
- **AI-powered monitoring** — VLM-based detection with custom labels/tags, alert snoozing, and detection history

### Projects & Collaboration

- **Multi-project support** — Create, load, duplicate, and manage separate projects
- **Real-time sync** — All markers, drawings, layers, and pins shared live via Socket.IO
- **Project sharing** — Share projects with groups (admin/editor/viewer roles)
- **Layer management** — Create, rename, reorder, toggle visibility, and toggle labels per layer
- **Persistent state** — SQLite database with automatic save

### Multi-Tenant Organizations

- **Organization isolation** — Full data separation per organization
- **Role hierarchy** — Super-admin (cross-org), admin (org-level), user
- **Super admin panel** — Organization management, feature toggles, user assignment
- **Per-org settings** — Organization-specific API keys and configuration
- **Soft-delete** — 7-day grace period with nightly cleanup

### Authentication & Security

- **Session-based login** — 7-day expiration, httpOnly cookies
- **MFA** — TOTP (authenticator app) and WebAuthn (passkeys/security keys) with backup codes
- **Per-org MFA enforcement** — Organizations can require MFA for all members
- **Impersonation** — Super-admins can impersonate users for troubleshooting (with visible banner, restricted actions)
- **Per-org username uniqueness** — `user@slug` login format for multi-tenant environments
- **Feature gating** — 5 org-level feature flags (AI chat, WaSOS, infrastructure, upscale, MFA)
- **Security** — bcrypt passwords, rate limiting, account locking, audit logging

### Internationalization

- Norwegian (default) and English
- Language toggle in the UI

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Toggle wind overlay |
| `C` | Toggle webcams |
| `A` | Toggle avalanche terrain |
| `V` | Toggle avalanche warnings |
| `S` | Toggle snow depth |
| `D` | Toggle drawing tools |
| `M` | Toggle measuring tool |
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
- **APIs**: Kartverket (tiles, search, elevation), MET Norway (weather, sun/moon), Vegvesen (webcams, routing, Street View, NVDB), NVE/Varsom (avalanche warnings + terrain), seNorge (snow depth)
- **Deployment**: Docker, nginx

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for AI features (set via admin panel or .env) |
| `CLAUDE_MODEL` | Model ID (default: `claude-sonnet-4-5-20250929`) |
| `PORT` | Backend port (default: `3001`) |
| `DATA_DIR` | Persistent data directory (default: `./data`) |
| `SESSION_SECRET` | Secret for session cookies (auto-generated on install) |

## License

[Business Source License 1.1](LICENSE) — Non-commercial and personal use is permitted. Converts to Apache License 2.0 on 2030-03-14.
