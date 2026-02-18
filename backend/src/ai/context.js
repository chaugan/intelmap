import { markers, drawings, layers } from '../store/index.js';

export function buildContext(viewport) {
  const parts = ['## Current Map Context'];

  if (viewport) {
    const lat = viewport.latitude;
    const lon = viewport.longitude;
    const z = viewport.zoom;
    const b = viewport.bounds;
    parts.push(`### User's Current Map Viewport`);
    parts.push(`Center: latitude ${lat?.toFixed(4)}°, longitude ${lon?.toFixed(4)}°`);
    parts.push(`Zoom level: ${z?.toFixed(1)}`);
    if (b) {
      parts.push(`Visible area bounding box:`);
      parts.push(`  North: ${b.north?.toFixed(4)}°, South: ${b.south?.toFixed(4)}°`);
      parts.push(`  East: ${b.east?.toFixed(4)}°, West: ${b.west?.toFixed(4)}°`);
    }
  }

  const allMarkers = markers.getAll();
  const allDrawings = drawings.getAll();
  const allLayers = layers.getAll();

  if (allLayers.length > 0) {
    parts.push(`\n### Existing Layers (${allLayers.length}):`);
    parts.push('Use these layer IDs when placing markers to organize them into existing layers.');
    allLayers.forEach(l => {
      parts.push(`- "${l.name}" (layerId: "${l.id}", ${l.visible ? 'visible' : 'hidden'}, source: ${l.source})`);
    });
  }

  if (allMarkers.length > 0) {
    parts.push(`\n### Existing Markers (${allMarkers.length}):`);
    allMarkers.slice(0, 20).forEach(m => {
      parts.push(`- ${m.designation || 'Unknown'} (SIDC: ${m.sidc}) at [${m.lat?.toFixed(4)}, ${m.lon?.toFixed(4)}]`);
    });
    if (allMarkers.length > 20) parts.push(`... and ${allMarkers.length - 20} more`);
  }

  if (allDrawings.length > 0) {
    parts.push(`\n### Existing Drawings (${allDrawings.length}):`);
    allDrawings.slice(0, 10).forEach(d => {
      parts.push(`- ${d.drawingType}: ${d.properties?.label || '(no label)'}`);
    });
    if (allDrawings.length > 10) parts.push(`... and ${allDrawings.length - 10} more`);
  }

  return parts.join('\n');
}
