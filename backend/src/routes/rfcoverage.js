import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { buildTileMap, destination } from './dem-utils.js';
import { addRFCoverage, deleteRFCoverage, updateRFCoverageLabel } from '../store/rfcoverage-store.js';
import { canMutateProject } from '../auth/project-access.js';

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

// Core RF propagation calculation — returns { geojson, stats, antennaElevation, parameters }
async function calculateRF({ longitude, latitude, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening }) {
  const height = Math.max(0.5, Math.min(100, Number(antennaHeight) || 1.5));
  const txPower = Math.max(0.1, Math.min(100, Number(txPowerWatts) || 5));
  const freq = Math.max(2, Math.min(6000, Number(frequencyMHz) || 150));
  const radius = Math.max(1, Math.min(30, Number(radiusKm) || 15));
  const radiusMeters = radius * 1000;

  const txPowerDbm = wattsToDbm(txPower);
  const dampeningDb = Math.min(0, Number(dampening) || 0);
  const lambda = 300 / freq;

  const { tileMap, getElevation } = await buildTileMap(latitude, longitude, radius);

  if (tileMap.size === 0) {
    throw Object.assign(new Error('Failed to fetch elevation data'), { statusCode: 502 });
  }

  const groundElevation = getElevation(longitude, latitude);
  const txElevation = groundElevation + height;

  const numRays = 360;
  const sampleStep = radius > 15 ? 150 : radius > 8 ? 100 : radius > 3 ? 60 : 30;
  const numSamples = Math.ceil(radiusMeters / sampleStep);

  const signalGrid = new Array(numRays);
  const bucketCounts = Object.fromEntries(BUCKETS.map(b => [b.name, 0]));
  let totalSamples = 0;
  let maxRangeM = 0;

  const angleStep = 360 / numRays;
  for (let r = 0; r < numRays; r++) {
    const bearingRad = (r * angleStep) * Math.PI / 180;
    signalGrid[r] = new Float32Array(numSamples);

    const profileElev = new Float64Array(numSamples);
    const profileDist = new Float64Array(numSamples);

    for (let s = 0; s < numSamples; s++) {
      const dist = (s + 1) * sampleStep;
      const pt = destination(latitude, longitude, bearingRad, dist);
      profileElev[s] = getElevation(pt.lon, pt.lat);
      profileDist[s] = dist;
    }

    for (let s = 0; s < numSamples; s++) {
      const dist = profileDist[s];
      const distKm = dist / 1000;
      const fspl = 20 * Math.log10(distKm) + 20 * Math.log10(freq) + 32.44;
      const rxElev = profileElev[s];
      let worstV = -Infinity;

      for (let k = 0; k < s; k++) {
        const d1 = profileDist[k];
        const d2 = dist - d1;
        if (d1 <= 0 || d2 <= 0) continue;
        const fraction = d1 / dist;
        const losHeight = txElevation + fraction * (rxElev - txElevation);
        const terrainH = profileElev[k];
        const obstHeight = terrainH - losHeight;
        if (obstHeight > 0) {
          const v = obstHeight * Math.sqrt(2 * (d1 + d2) / (lambda * d1 * d2));
          if (v > worstV) worstV = v;
        }
      }

      let diffLoss = 0;
      if (worstV > -0.78) {
        diffLoss = 6.9 + 20 * Math.log10(Math.sqrt(worstV * worstV + 1) + worstV);
        if (diffLoss < 0) diffLoss = 0;
      }

      const pRx = txPowerDbm - fspl - diffLoss + dampeningDb;
      signalGrid[r][s] = pRx;

      const bucket = getBucket(pRx);
      bucketCounts[bucket.name]++;
      totalSamples++;

      if (pRx >= -90 && dist > maxRangeM) {
        maxRangeM = dist;
      }
    }
  }

  const features = [];
  const rd = (v) => Math.round(v * 10000) / 10000;

  for (let r = 0; r < numRays; r++) {
    const bearing1 = (r * angleStep - angleStep / 2) * Math.PI / 180;
    const bearing2 = (r * angleStep + angleStep / 2) * Math.PI / 180;

    for (let s = 0; s < numSamples; s++) {
      const pRx = signalGrid[r][s];
      if (pRx < -95) continue;

      const bucket = getBucket(pRx);
      const dNear = s * sampleStep;
      const dFar = (s + 1) * sampleStep;
      if (dFar <= 0) continue;

      const p1 = destination(latitude, longitude, bearing1, Math.max(dNear, 1));
      const p2 = destination(latitude, longitude, bearing2, Math.max(dNear, 1));
      const p3 = destination(latitude, longitude, bearing2, dFar);
      const p4 = destination(latitude, longitude, bearing1, dFar);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [rd(p1.lon), rd(p1.lat)],
            [rd(p2.lon), rd(p2.lat)],
            [rd(p3.lon), rd(p3.lat)],
            [rd(p4.lon), rd(p4.lat)],
            [rd(p1.lon), rd(p1.lat)],
          ]],
        },
        properties: {
          bucket: bucket.name,
          signalStrength: Math.round(pRx * 10) / 10,
        },
      });
    }
  }

  const geojson = { type: 'FeatureCollection', features };
  const totalAreaKm2 = Math.round(Math.PI * radius * radius * 100) / 100;
  const stats = {
    ...Object.fromEntries(BUCKETS.map(b => [b.name + 'Percent', totalSamples > 0 ? Math.round(bucketCounts[b.name] / totalSamples * 100) : 0])),
    maxRangeKm: Math.round(maxRangeM / 100) / 10,
    totalAreaKm2,
  };

  return {
    geojson,
    stats,
    antennaElevation: Math.round(groundElevation),
    parameters: { txPowerDbm: Math.round(txPowerDbm * 10) / 10, frequencyMHz: freq, antennaHeight: height },
  };
}

router.post('/calculate', async (req, res) => {
  try {
    const { longitude, latitude } = req.body;
    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    const result = await calculateRF(req.body);
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    console.error('RF coverage calculation error:', err);
    res.status(status).json({ error: err.message || 'RF coverage calculation failed' });
  }
});

// Save RF coverage — server re-calculates to avoid large client upload
router.post('/save', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId, layerId, longitude, latitude, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening, showLabel } = req.body;
    if (!projectId || !canMutateProject(userId, projectId)) {
      return res.status(403).json({ error: 'No access' });
    }
    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    // Re-calculate server-side (DEM tiles are cached, so this is fast)
    const result = await calculateRF({ longitude, latitude, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening });

    const coverage = addRFCoverage(projectId, {
      layerId, longitude, latitude, antennaHeight, txPowerWatts, frequencyMHz, radiusKm,
      geojson: result.geojson, stats: result.stats, showLabel: !!showLabel, createdBy: userId,
    });

    // Notify other clients via socket (same shape as socket handler)
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${projectId}`).emit('server:rfcoverage:added', coverage);
    }

    // Return metadata only — client already has the geojson from /calculate
    const { geojson: _, ...meta } = coverage;
    res.json(meta);
  } catch (err) {
    console.error('RF coverage save error:', err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// Toggle label visibility for a saved RF coverage
router.patch('/:id/label', (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId, showLabel } = req.body;
    if (!projectId || !canMutateProject(userId, projectId)) {
      return res.status(403).json({ error: 'No access' });
    }
    const ok = updateRFCoverageLabel(req.params.id, projectId, showLabel);
    if (!ok) return res.status(404).json({ error: 'Not found' });

    const io = req.app.get('io');
    if (io) {
      io.to(`project:${projectId}`).emit('server:rfcoverage:label-updated', { projectId, id: req.params.id, showLabel: !!showLabel });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('RF coverage label update error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Delete RF coverage via HTTP
router.delete('/:id', (req, res) => {
  try {
    const userId = req.user.id;
    const { projectId } = req.body;
    if (!projectId || !canMutateProject(userId, projectId)) {
      return res.status(403).json({ error: 'No access' });
    }
    const ok = deleteRFCoverage(req.params.id, projectId);
    if (!ok) return res.status(404).json({ error: 'Not found' });

    // Notify other clients
    const io = req.app.get('io');
    if (io) {
      io.to(`project:${projectId}`).emit('server:rfcoverage:deleted', { projectId, id: req.params.id });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('RF coverage delete error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

export default router;
