import { BASE_LAYERS } from './constants.js';

const GEONORGE_WMS = 'https://wms.geonorge.no/skwms1/wms.kartdata?SERVICE=WMS&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=&VERSION=1.3.0&WIDTH=256&HEIGHT=256&CRS=EPSG:3857';

export function buildMapStyle(baseLayerId, {
  avalancheVisible = false,
  avalancheWarningsVisible = false,
  avalancheWarningsOpacity = 0.5,
  avalancheWarningsData = null,
  snowDepthVisible = false,
  snowDepthOpacity = 0.7,
  trafficFlowVisible = false,
  trafficFlowOpacity = 0.9,
  wmsTransportVisible = false,
  wmsTransportOpacity = 0.8,
  wmsPlacenamesVisible = false,
  wmsPlacenamesOpacity = 0.9,
  wmsContoursVisible = false,
  wmsContoursOpacity = 0.7,
  wmsBordersVisible = false,
  wmsBordersOpacity = 0.8,
  auroraVisible = false,
  overlayOrder = ['aurora', 'avalancheWarnings', 'avalanche', 'snowDepth', 'traffic', 'wind'],
} = {}) {
  const layer = BASE_LAYERS[baseLayerId] || BASE_LAYERS.topo;

  const sources = {
    base: {
      type: 'raster',
      tiles: [layer.url],
      tileSize: 256,
      attribution: baseLayerId.startsWith('osm')
        ? '&copy; OpenStreetMap contributors'
        : baseLayerId.startsWith('satellite')
          ? '&copy; Esri, Maxar, Earthstar Geographics'
          : '&copy; Kartverket',
    },
    dem: {
      type: 'raster-dem',
      tiles: ['/api/tiles/dem/{z}/{x}/{y}.png'],
      tileSize: 256,
      encoding: 'terrarium',
    },
  };

  const isGrayscale = layer.grayscale;
  const layers = [
    {
      id: 'base-tiles',
      type: 'raster',
      source: 'base',
      minzoom: 0,
      maxzoom: 20,
      ...(isGrayscale ? { paint: { 'raster-saturation': -1 } } : {}),
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

  if (trafficFlowVisible) {
    sources['traffic-flow'] = {
      type: 'raster',
      tiles: ['/api/tiles/traffic/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 6,
      maxzoom: 16,
    };
    overlayDefs.trafficFlow = {
      id: 'traffic-flow-layer',
      type: 'raster',
      source: 'traffic-flow',
      minzoom: 6,
      paint: { 'raster-opacity': trafficFlowOpacity },
    };
  }

  if (wmsTransportVisible) {
    sources['wms-transport'] = {
      type: 'raster',
      tiles: [`${GEONORGE_WMS}&LAYERS=kd_veger,kd_jernbane,kd_ferger&BBOX={bbox-epsg-3857}`],
      tileSize: 256,
    };
    overlayDefs.wmsTransport = {
      id: 'wms-transport-layer',
      type: 'raster',
      source: 'wms-transport',
      paint: { 'raster-opacity': wmsTransportOpacity },
    };
  }

  if (wmsPlacenamesVisible) {
    sources['wms-placenames'] = {
      type: 'raster',
      tiles: [`${GEONORGE_WMS}&LAYERS=kd_stedsnavn&BBOX={bbox-epsg-3857}`],
      tileSize: 256,
    };
    overlayDefs.wmsPlacenames = {
      id: 'wms-placenames-layer',
      type: 'raster',
      source: 'wms-placenames',
      paint: { 'raster-opacity': wmsPlacenamesOpacity },
    };
  }

  if (wmsContoursVisible) {
    sources['wms-contours'] = {
      type: 'raster',
      tiles: [`${GEONORGE_WMS}&LAYERS=kd_hoydekurver&BBOX={bbox-epsg-3857}`],
      tileSize: 256,
    };
    overlayDefs.wmsContours = {
      id: 'wms-contours-layer',
      type: 'raster',
      source: 'wms-contours',
      paint: { 'raster-opacity': wmsContoursOpacity },
    };
  }

  if (wmsBordersVisible) {
    sources['wms-borders'] = {
      type: 'raster',
      tiles: [`${GEONORGE_WMS}&LAYERS=kd_administrative_grenser&BBOX={bbox-epsg-3857}`],
      tileSize: 256,
    };
    overlayDefs.wmsBorders = {
      id: 'wms-borders-layer',
      type: 'raster',
      source: 'wms-borders',
      paint: { 'raster-opacity': wmsBordersOpacity },
    };
  }

  // Push overlays in the user-configured z-order (bottom to top)
  // Note: Aurora is rendered via canvas overlay (AuroraOverlay.jsx), not MapLibre
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
