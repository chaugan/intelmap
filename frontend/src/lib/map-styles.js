import { BASE_LAYERS } from './constants.js';

export function buildMapStyle(baseLayerId, { avalancheVisible = false } = {}) {
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

  if (avalancheVisible) {
    sources['avalanche-wms'] = {
      type: 'raster',
      tiles: ['/api/tiles/avalanche/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 9,
      maxzoom: 14,
    };
    layers.push({
      id: 'avalanche-layer',
      type: 'raster',
      source: 'avalanche-wms',
      minzoom: 9,
      paint: {
        'raster-opacity': 0.6,
        'raster-saturation': 1,
        'raster-hue-rotate': -20,
        'raster-contrast': 0.3,
      },
    });
  }

  return { version: 8, sources, layers };
}

