# IntelMap

Military tactical map server for exercises in Norway. Real-time collaborative mapping with AI-powered command interface, NATO symbology, weather intelligence, and Norwegian topographic data.

## Features

**Map Layers**
- Kartverket topographic, grayscale, raster, and OpenStreetMap base maps
- Wind overlay with animated particles
- Webcam layer from Vegvesen road cameras
- Avalanche danger zones from Varsom/NVE

**Tactical Tools**
- NATO APP-6 military symbols — infantry, armor, artillery, air defense, aviation, engineer, recon, logistics, medical, HQ, signals, special forces, obstacles, naval, CBRN
- Friendly / hostile / neutral affiliations
- Drawing tools: line, polygon, circle, arrow, freehand, text
- Custom layer management for organizing overlays

**AI Assistant**
- Natural language map manipulation via Claude
- Location search, marker placement, route planning
- Road routing and cross-country terrain routing with elevation awareness
- Layer creation and drawing commands

**Weather Intelligence**
- MET Norway forecasts with temperature, wind, precipitation
- Sunrise / sunset and moon phase data

**Collaboration**
- Real-time sync via Socket.IO — all markers, drawings, and layers shared live
- Persistent state with automatic save/load

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Toggle wind overlay |
| `C` | Toggle webcams |
| `A` | Toggle avalanche zones |
| `1` | Layers panel |
| `2` | Symbols panel |
| `3` | Weather panel |
| `4` | Search panel |
| `I` | AI chat |
| `Esc` | Cancel current action |

## Tech Stack

- **Frontend**: React 19, Vite, MapLibre GL JS, Tailwind CSS v4, Zustand
- **Backend**: Express, Socket.IO, Anthropic Claude SDK
- **APIs**: Kartverket (tiles, search, elevation), MET Norway (weather, sun/moon), Vegvesen (webcams), Varsom (avalanche)

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

Frontend dev server at `http://localhost:5173`, backend at `http://localhost:3001`.


## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for AI features |
| `CLAUDE_MODEL` | Model ID (default: `claude-sonnet-4-5-20250929`) |
| `PORT` | Backend port (default: `3001`) |
| `DATA_DIR` | Persistent data directory (default: `./data`) |

## License

[MIT](LICENSE)
