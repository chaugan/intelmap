# Handover Document for CoreMap26

This document transfers knowledge from a previous Claude session to help you continue work on this project.

## Project Overview

CoreMap26 (IntelMap) is a military tactical map server for exercises in Norway. Stack: React 19 + Vite 7 + MapLibre GL JS + Express + Socket.IO + Docker.

## Recent Work: Road Restrictions Feature

The most recent session focused heavily on the **Road Restrictions Layer** (`frontend/src/components/map/RoadRestrictionsLayer.jsx`). Here's what was implemented:

### Key Features Implemented

1. **Sticky/Pinned Popups**: Restriction popups can be pinned and will stay visible when clicking other restrictions or panning the map. Uses `pinnedIdsRef` (a ref) to avoid stale closure issues in click handlers.

2. **Multiple Simultaneous Popups**: Uses `openFeatures` (Map) and `pinnedIds` (Set) state to track multiple open popups.

3. **Popup Header Color Matching**: The popup header color matches the restriction's bucket color (e.g., dark red for <20t weight, violet for <3m height). Uses `getValueColor()` and `hexToRgba()` functions.

4. **Municipality Names**: Backend fetches kommune names from NVDB `/omrader/kommuner` endpoint and caches them. Converts kommune numbers to names in `backend/src/routes/nvdb.js`.

5. **Pulsation/Glow Highlight Feature**:
   - Vibration icon button next to each toggle (weight/height) in the legend
   - Click to start pulsation, runs for 30 seconds or until clicked again
   - **Separate glow layers** render behind main layers (avoids line stretching)
   - Glow layers: `LAYER_WEIGHT_GLOW`, `LAYER_HEIGHT_GLOW`, `LAYER_WEIGHT_POINTS_GLOW`, `LAYER_HEIGHT_POINTS_GLOW`
   - Animation: 5 second cycle, opacity 0.3-1.0, width 14-30
   - Store state: `weightPulsating`, `heightPulsating` with setters

6. **Buildings Occlusion**: Restriction layers are inserted with `beforeId: OFM_EXTRUSION_LAYER` so 3D buildings render on top when map is tilted.

7. **Style Change Handling**: Uses `styledata` event (NOT `style.load`) to re-add layers after base map changes.

### Layer Structure

```
GLOW_LAYERS (opacity 0 by default, animated when pulsating):
  - road-restrictions-weight-glow
  - road-restrictions-height-glow
  - road-restrictions-weight-points-glow
  - road-restrictions-height-points-glow

MAIN_LAYERS:
  - road-restrictions-weight-lines (solid, 5px width)
  - road-restrictions-height-lines (dashed, 4px width)
  - road-restrictions-weight-points (circle, 8px radius)
  - road-restrictions-height-points (circle, 8px radius)
```

### Color Buckets

**Weight (orange/red scheme)**:
- <20t: `#b91c1c` (dark red)
- 20-30t: `#dc2626` (red)
- 30-40t: `#ea580c` (orange)
- 40-60t: `#f59e0b` (amber)
- >60t: `#fbbf24` (yellow)

**Height (purple/blue scheme)**:
- <3m: `#7c3aed` (violet)
- 3-3.5m: `#8b5cf6` (purple)
- 3.5-4m: `#3b82f6` (blue)
- 4-4.5m: `#0ea5e9` (sky)
- >4.5m: `#06b6d4` (cyan)

### Known Patterns & Gotchas

1. **Stale Closure Fix**: Use refs (`pinnedIdsRef`) for values accessed in event handlers to avoid capturing stale state.

2. **MapLibre Line Glow**: Don't use `line-blur` on main layers (causes stretching). Instead, create separate glow layers with higher width, blur, and animated opacity.

3. **Filter Sync**: When updating filters for main layers, also update glow layers with same filter.

4. **Click Location**: Use `e.lngLat` for popup anchor, not geometry midpoint.

5. **Badge Counter**: `roadRestrictionsVisible` is in `VISIBILITY_KEYS` array in `MapControls.jsx` for toolbar badge.

### Files Modified

- `frontend/src/components/map/RoadRestrictionsLayer.jsx` - Main layer + legend
- `frontend/src/stores/useMapStore.js` - Added `weightPulsating`, `heightPulsating` state
- `frontend/src/styles/globals.css` - Added `.animate-pulse-color` keyframe animation
- `frontend/src/components/map/TacticalMap.jsx` - Passes `mapRef` to legend
- `backend/src/routes/nvdb.js` - Kommune name lookup

### CSS Animation

```css
@keyframes pulse-color {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.3); }
}
.animate-pulse-color {
  animation: pulse-color 5s ease-in-out infinite;
}
```

## Version

Current version: `0.32.22` (in `frontend/src/version.js`)

**Always bump version on every commit!**

## Commands

- Frontend dev: `cd frontend && npm run dev`
- Backend: `cd backend && node src/index.js`
- Docker: `docker-compose up --build`
- Git/GitHub: Use WSL (`wsl -d Ubuntu`) for `git` and `gh` commands

## Important Notes from CLAUDE.md

- No GitHub releases needed - just commit and push, server syncs automatically
- Version in `frontend/src/version.js` must be bumped on every commit
- Use local time (not UTC) for file download timestamps
- i18n: `frontend/src/lib/i18n.js` with `no`/`en` locales (Norwegian default)

---

*Delete this file after you've absorbed the knowledge. Good luck!*
