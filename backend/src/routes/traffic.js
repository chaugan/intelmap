import { Router } from 'express';

const router = Router();
let cachedTraffic = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute server-side cache

// Categorize incident type based on type string and description
function categorizeIncident(type, description) {
  const t = (type || '').toLowerCase();
  const d = (description || '').toLowerCase();

  // Check for accident first (highest priority)
  if (t.includes('accident') || d.includes('ulykke') || d.includes('kollisjon')) {
    return 'accident';
  }

  // Road closure (full closure, not temporary for works)
  if ((t.includes('closed') || t.includes('closure')) &&
      !t.includes('intermittent') && !t.includes('shortterm') &&
      !d.includes('vegarbeid') && !d.includes('arbeid')) {
    return 'roadClosed';
  }

  // Roadworks - check type and description
  if (t.includes('roadworks') || t.includes('works') || t.includes('maintenance') ||
      t.includes('construction') || t.includes('trafficlights') ||
      d.includes('vegarbeid') || d.includes('arbeid på') || d.includes('anleggsarbeid')) {
    return 'roadworks';
  }

  // Temporary closures for roadwork (description usually mentions vegarbeid)
  if ((t.includes('closure') || t.includes('closed')) &&
      (d.includes('vegarbeid') || d.includes('arbeid'))) {
    return 'roadworks';
  }

  // Obstruction
  if (t.includes('obstruction') || t.includes('object') || d.includes('hinder') || d.includes('gjenstand')) {
    return 'obstruction';
  }

  // Road conditions
  if (t.includes('condition') || t.includes('weather') || t.includes('winter') ||
      d.includes('glatt') || d.includes('is på') || d.includes('snø')) {
    return 'conditions';
  }

  return 'other';
}

router.get('/', async (_req, res) => {
  try {
    if (cachedTraffic && Date.now() - cacheTime < CACHE_TTL) {
      return res.json(cachedTraffic);
    }

    const url = 'https://ogckart-sn1.atlas.vegvesen.no/wfs?service=wfs&version=2.0.0&request=GetFeature&typeName=datex_3_1:SituationSimple_v2&outputFormat=application/json';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`WFS ${response.status}`);
    const geojson = await response.json();

    // Filter for Norway bounds and transform properties
    const filtered = {
      type: 'FeatureCollection',
      meta: { total: 0, fetchedAt: new Date().toISOString() },
      features: (geojson.features || [])
        .filter((f) => {
          const coords = f.geometry?.coordinates;
          if (!coords) return false;
          // Handle both Point and LineString geometries
          const [lon, lat] = Array.isArray(coords[0]) ? coords[0] : coords;
          // Filter for Norway (lat 57.5-71.5, lon 4-32)
          return lat >= 57.5 && lat <= 71.5 && lon >= 4 && lon <= 32;
        })
        .map((f) => {
          const props = f.properties || {};
          const rawType = props.SECONDARY_TYPES || props.SITUATION_TYPE || 'unknown';
          const description = props.DESCRIPTION || '';
          const category = categorizeIncident(rawType, description);
          return {
            type: 'Feature',
            geometry: f.geometry,
            properties: {
              id: props.ID || props.SITUATION_ID || f.id,
              type: rawType,
              category,
              description,
              road: props.ROAD_NUMBER || null,
              severity: props.SEVERITY || 'low',
              location: props.LOCATION_DESCRIPTION || '',
              startTime: props.START_TIME || null,
              endTime: props.END_TIME || null,
              active: props.ACTIVE !== false,
              lastUpdate: props.LAST_UPDATE_TIME || null,
            },
          };
        }),
    };
    filtered.meta.total = filtered.features.length;

    cachedTraffic = filtered;
    cacheTime = Date.now();
    res.json(filtered);
  } catch (err) {
    // Return stale cache if available
    if (cachedTraffic) return res.json(cachedTraffic);
    res.status(502).json({ error: err.message });
  }
});

export default router;
