import fs from 'fs';
import path from 'path';
import config from '../config.js';
import { createMarkerStore } from './markers.js';
import { createDrawingStore } from './drawings.js';
import { createLayerStore } from './layers.js';

const dataFile = path.join(config.dataDir, 'state.json');

// Legacy in-memory stores (kept for backward compat during transition)
export const markers = createMarkerStore();
export const drawings = createDrawingStore();
export const layers = createLayerStore();

export function getFullState() {
  return {
    markers: markers.getAll(),
    drawings: drawings.getAll(),
    layers: layers.getAll(),
  };
}

export function saveState() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(getFullState(), null, 2));
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

export function loadState() {
  try {
    if (fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
      if (data.markers) data.markers.forEach(m => markers.set(m.id, m));
      if (data.drawings) data.drawings.forEach(d => drawings.set(d.id, d));
      if (data.layers) data.layers.forEach(l => layers.set(l.id, l));
    }
  } catch (err) {
    console.error('Failed to load state:', err.message);
  }
}

// Re-export the project store for Phase 2 code
export { projectStore } from './project-store.js';
