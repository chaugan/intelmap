import { BASE_LAYERS } from './constants.js';

export function buildMapStyle(baseLayerId, {
  avalancheVisible = false,
  avalancheWarningsVisible = false,
  avalancheWarningsOpacity = 0.5,
  avalancheWarningsData = null,
  snowDepthVisible = false,
  snowDepthOpacity = 0.7,
  overlayOrder = ['avalancheWarnings', 'avalanche', 'snowDepth', 'wind'],
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
  // Value can be a single layer object or an array of layers
  const overlayDefs = {};

  if (avalancheWarningsVisible && avalancheWarningsData) {
    sources['avalanche-warnings-geojson'] = {
      type: 'geojson',
      data: avalancheWarningsData,
    };
    overlayDefs.avalancheWarnings = [
      {
        id: 'avalanche-warnings-fill',
        type: 'fill',
        source: 'avalanche-warnings-geojson',
        paint: {
          'fill-color': [
            'match', ['get', 'dangerLevel'],
            1, '#56B528',
            2, '#FFE800',
            3, '#F18700',
            4, '#E81700',
            5, '#1B1B1B',
            '#888888',
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'dangerLevel'], 0], avalancheWarningsOpacity * 0.3,
            avalancheWarningsOpacity,
          ],
        },
      },
      {
        id: 'avalanche-warnings-line',
        type: 'line',
        source: 'avalanche-warnings-geojson',
        paint: {
          'line-color': '#333',
          'line-width': 1,
          'line-opacity': 0.6,
        },
      },
    ];
  }

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

  // Push overlays in the user-configured z-order (bottom to top)
  // Overlay defs can be a single layer or an array of layers
  for (const id of overlayOrder) {
    const def = overlayDefs[id];
    if (!def) continue;
    if (Array.isArray(def)) {
      layers.push(...def);
    } else {
      layers.push(def);
    }
  }

  return { version: 8, sources, layers };
}
