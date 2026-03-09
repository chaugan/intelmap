import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { buildTileMap, destination } from './dem-utils.js';

const router = Router();
router.use(requireAuth);

// Signal strength thresholds (dBm) — 5 dB steps from -50 to -90
const BUCKETS = [
  { name: 'excellent',  min: -50, color: '#15803d' },
  { name: 'veryGood',   min: -55, color: '#22c55e' },
  { name: 'good',       min: -60, color: '#4ade80' },
  { name: 'aboveAvg',   min: -65, color: '#84cc16' },
  { name: 'average',    min: -70, color: '#eab308' },
  { name: 'belowAvg',   min: -75, color: '#f59e0b' },
  { name: 'marginal',   min: -80, color: '#f97316' },
  { name: 'weak',       min: -85, color: '#ef4444' },
  { name: 'veryWeak',   min: -90, color: '#dc2626' },
  { name: 'noCoverage', min: -Infinity, color: '#991b1b' },
];

function getBucket(dBm) {
  for (const b of BUCKETS) {
    if (dBm >= b.min) return b;
  }
  return BUCKETS[BUCKETS.length - 1];
}

function wattsToDbm(watts) {
  return 10 * Math.log10(watts * 1000);
}

router.post('/calculate', async (req, res) => {
  try {
    const { longitude, latitude, antennaHeight, txPowerWatts, frequencyMHz, radiusKm: rawRadius } = req.body;

    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const height = Math.max(0.5, Math.min(100, Number(antennaHeight) || 1.5));
    const txPower = Math.max(0.1, Math.min(100, Number(txPowerWatts) || 5));
    const freq = Math.max(2, Math.min(6000, Number(frequencyMHz) || 150));
    const radius = Math.max(1, Math.min(30, Number(rawRadius) || 15));
    const radiusMeters = radius * 1000;

    const txPowerDbm = wattsToDbm(txPower);
    const lambda = 300 / freq; // wavelength in meters

    const { tileMap, getElevation } = await buildTileMap(latitude, longitude, radius);

    if (tileMap.size === 0) {
      return res.status(502).json({ error: 'Failed to fetch elevation data' });
    }

    const groundElevation = getElevation(longitude, latitude);
    const txElevation = groundElevation + height;

    const numRays = 720;
    const sampleStep = radius > 10 ? 100 : radius > 3 ? 50 : 30;
    const numSamples = Math.ceil(radiusMeters / sampleStep);

    // signalGrid[ray][sample] = dBm value
    const signalGrid = new Array(numRays);
    const bucketCounts = Object.fromEntries(BUCKETS.map(b => [b.name, 0]));
    let totalSamples = 0;
    let maxRangeM = 0;

    for (let r = 0; r < numRays; r++) {
      const bearingRad = (r * 0.5) * Math.PI / 180;
      signalGrid[r] = new Float32Array(numSamples);

      // Build terrain profile along ray for obstruction checks
      const profileElev = new Float64Array(numSamples);
      const profileDist = new Float64Array(numSamples);
      const profilePts = new Array(numSamples);

      for (let s = 0; s < numSamples; s++) {
        const dist = (s + 1) * sampleStep;
        const pt = destination(latitude, longitude, bearingRad, dist);
        profileElev[s] = getElevation(pt.lon, pt.lat);
        profileDist[s] = dist;
        profilePts[s] = pt;
      }

      for (let s = 0; s < numSamples; s++) {
        const dist = profileDist[s];
        const distKm = dist / 1000;

        // Free-space path loss
        const fspl = 20 * Math.log10(distKm) + 20 * Math.log10(freq) + 32.44;

        // Check for terrain obstruction between tx and this sample
        // LOS line from txElevation to sample terrain elevation + 0 (receiver at ground)
        const rxElev = profileElev[s];
        let worstV = -Infinity;

        // Check all intermediate points for obstruction
        for (let k = 0; k < s; k++) {
          const d1 = profileDist[k];
          const d2 = dist - d1;
          if (d1 <= 0 || d2 <= 0) continue;

          // LOS height at this intermediate point
          const fraction = d1 / dist;
          const losHeight = txElevation + fraction * (rxElev - txElevation);

          // Terrain height at intermediate point
          const terrainH = profileElev[k];
          const obstHeight = terrainH - losHeight;

          if (obstHeight > 0) {
            // Knife-edge diffraction: Fresnel parameter v
            const v = obstHeight * Math.sqrt(2 * (d1 + d2) / (lambda * d1 * d2));
            if (v > worstV) worstV = v;
          }
        }

        // Diffraction loss
        let diffLoss = 0;
        if (worstV > -0.78) {
          diffLoss = 6.9 + 20 * Math.log10(Math.sqrt(worstV * worstV + 1) + worstV);
          if (diffLoss < 0) diffLoss = 0;
        }

        const pRx = txPowerDbm - fspl - diffLoss;
        signalGrid[r][s] = pRx;

        const bucket = getBucket(pRx);
        bucketCounts[bucket.name]++;
        totalSamples++;

        if (pRx >= -90 && dist > maxRangeM) {
          maxRangeM = dist;
        }
      }
    }

    // Build GeoJSON wedge polygons — merge consecutive samples in same bucket per ray
    const features = [];
    const angleStep = 0.5;

    for (let r = 0; r < numRays; r++) {
      const bearingRad = (r * 0.5) * Math.PI / 180;
      let startSample = 0;
      let currentBucket = getBucket(signalGrid[r][0]);

      for (let s = 0; s <= numSamples; s++) {
        const bucket = s < numSamples ? getBucket(signalGrid[r][s]) : null;

        if (!bucket || bucket.name !== currentBucket.name) {
          // Emit wedge from startSample to s-1
          const bearing1 = (r * angleStep - angleStep / 2) * Math.PI / 180;
          const bearing2 = (r * angleStep + angleStep / 2) * Math.PI / 180;
          const dNear = (startSample + 1) * sampleStep;
          const dFar = (s) * sampleStep;

          if (dFar > dNear) {
            const p1 = destination(latitude, longitude, bearing1, dNear);
            const p2 = destination(latitude, longitude, bearing2, dNear);
            const p3 = destination(latitude, longitude, bearing2, dFar);
            const p4 = destination(latitude, longitude, bearing1, dFar);

            features.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  [p1.lon, p1.lat],
                  [p2.lon, p2.lat],
                  [p3.lon, p3.lat],
                  [p4.lon, p4.lat],
                  [p1.lon, p1.lat],
                ]],
              },
              properties: {
                color: currentBucket.color,
                bucket: currentBucket.name,
                signalStrength: currentBucket.min,
              },
            });
          }

          if (bucket) {
            startSample = s;
            currentBucket = bucket;
          }
        }
      }
    }

    const geojson = { type: 'FeatureCollection', features };

    const totalAreaKm2 = Math.round(Math.PI * radius * radius * 100) / 100;
    const stats = {
      ...Object.fromEntries(BUCKETS.map(b => [b.name + 'Percent', totalSamples > 0 ? Math.round(bucketCounts[b.name] / totalSamples * 100) : 0])),
      maxRangeKm: Math.round(maxRangeM / 100) / 10,
      totalAreaKm2,
    };

    res.json({
      geojson,
      stats,
      antennaElevation: Math.round(groundElevation),
      parameters: { txPowerDbm: Math.round(txPowerDbm * 10) / 10, frequencyMHz: freq, antennaHeight: height },
    });
  } catch (err) {
    console.error('RF coverage calculation error:', err);
    res.status(500).json({ error: 'RF coverage calculation failed' });
  }
});

export default router;
