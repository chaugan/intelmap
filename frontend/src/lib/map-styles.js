import { BASE_LAYERS } from './constants.js';

export function buildMapStyle(baseLayerId, {
  avalancheVisible = false,
  snowDepthVisible = false,
  snowDepthOpacity = 0.7,
  overlayOrder = ['avalanche', 'snowDepth', 'wind'],
} = {}) {
  const layer = BASE_LAYERS[baseLayerId] || BASE_LAYERS.topo;

  const sources = {
    base: {
      type: 'raster',
      tiles: [layer.url],
      tileSize: 256,
      attribution: baseLayerId === 'osm'
        ? '&copy; OpenStreetMap contributors'
        : '&copy; Kartverket',
    },
  };

  const layers = [
    {
      id: 'base-tiles',
      type: 'raster',
      source: 'base',
      minzoom: 0,
      maxzoom: 20,
    },
  ];

  // Build overlay definitions keyed by id
  const overlayDefs = {};

  if (avalancheVisible) {
    sources['avalanche-wms'] = {
      type: 'raster',
      tiles: ['/api/tiles/avalanche/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 9,
      maxzoom: 14,
    };
    overlayDefs.avalanche = {
      id: 'avalanche-layer',
      type: 'raster',
      source: 'avalanche-wms',
      minzoom: 9,
      paint: { 'raster-opacity': 0.4 },
    };
  }

  if (snowDepthVisible) {
    sources['snowdepth-img'] = {
      type: 'raster',
      tiles: ['/api/tiles/snowdepth/{z}/{x}/{y}.png?v=2'],
      tileSize: 256,
      minzoom: 5,
      maxzoom: 13,
    };
    overlayDefs.snowDepth = {
      id: 'snowdepth-layer',
      type: 'raster',
      source: 'snowdepth-img',
      minzoom: 5,
      paint: { 'raster-opacity': snowDepthOpacity },
    };
  }

  // Push raster overlays in the user-configured z-order (bottom to top)
  for (const id of overlayOrder) {
    if (overlayDefs[id]) layers.push(overlayDefs[id]);
  }

  return { version: 8, sources, layers };
}
