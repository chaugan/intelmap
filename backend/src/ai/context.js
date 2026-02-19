import { projectStore } from '../store/project-store.js';

export function buildContext(viewport, projectId) {
  const parts = ['## Current Map Context'];

  if (viewport) {
    const lat = viewport.latitude;
    const lon = viewport.longitude;
    const z = viewport.zoom;
    const b = viewport.bounds;
    parts.push(`### User's Current Map Viewport`);
    parts.push(`Center: latitude ${lat?.toFixed(4)}, longitude ${lon?.toFixed(4)}`);
    parts.push(`Zoom level: ${z?.toFixed(1)}`);
    if (b) {
      parts.push(`Visible area bounding box:`);
      parts.push(`  North: ${b.north?.toFixed(4)}, South: ${b.south?.toFixed(4)}`);
      parts.push(`  East: ${b.east?.toFixed(4)}, West: ${b.west?.toFixed(4)}`);
    }
  }

  if (!projectId) {
    parts.push('\n**No active project selected.** Ask the user to select a project before placing markers or drawings.');
    return parts.join('\n');
  }

  const state = projectStore.getProjectState(projectId);
  const allMarkers = state.markers;
  const allDrawings = state.drawings;
  const allLayers = state.layers;

  parts.push(`\n### Active Project ID: ${projectId}`);

  if (allLayers.length > 0) {
    parts.push(`\n### Existing Layers (${allLayers.length}):`);
    parts.push('Use these layer IDs when placing markers to organize them into existing layers.');
    allLayers.forEach(l => {
      parts.push(`- "${l.name}" (layerId: "${l.id}", ${l.visible ? 'visible' : 'hidden'}, source: ${l.source})`);
    });
  }

  if (allMarkers.length > 0) {
    parts.push(`\n### Existing Markers (${allMarkers.length}):`);
    parts.push('Use these IDs with `delete_markers` to remove markers.');
    allMarkers.slice(0, 20).forEach(m => {
      const layer = m.layerId ? `, layerId: "${m.layerId}"` : '';
      parts.push(`- id: "${m.id}" — ${m.designation || 'Unknown'} (SIDC: ${m.sidc}) at [${m.lat?.toFixed(4)}, ${m.lon?.toFixed(4)}]${layer}`);
    });
    if (allMarkers.length > 20) parts.push(`... and ${allMarkers.length - 20} more`);
  }

  if (allDrawings.length > 0) {
    parts.push(`\n### Existing Drawings (${allDrawings.length}):`);
    parts.push('Use these IDs with `delete_drawings` to remove drawings.');
    allDrawings.slice(0, 20).forEach(d => {
      const layer = d.layerId ? `, layerId: "${d.layerId}"` : '';
      parts.push(`- id: "${d.id}" — ${d.drawingType}: ${d.properties?.label || '(no label)'}${layer}`);
    });
    if (allDrawings.length > 20) parts.push(`... and ${allDrawings.length - 20} more`);
  }

  return parts.join('\n');
}
