import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { buildTileMap, destination, computeSurfaceNormal, reflectBearing, reflectionLossDb } from './dem-utils.js';
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

// Reflection constants
const MIN_REFLECTOR_SLOPE = 15;      // degrees — minimum slope to qualify as reflector
const BLOCKAGE_THRESHOLD = 15;       // dB diffraction loss triggers reflection detection
const MAX_BOUNCE_DEPTH = 2;          // max bounces (single + double)
const REFLECTION_SPREAD_DEG = 30;    // cone width for reflected sub-rays
const REFLECTION_SUB_RAYS = 15;      // rays per reflection (2° resolution)
const REFLECTION_BUDGET = 500;       // max total reflected rays (performance cap)

// Core RF propagation calculation — returns { geojson, stats, antennaElevation, parameters }
async function calculateRF({ longitude, latitude, antennaHeight, txPowerWatts, frequencyMHz, radiusKm, dampening, enableReflections = true }) {
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
  const reflectionQueue = [];
  let reflectionBudget = REFLECTION_BUDGET;

  for (let r = 0; r < numRays; r++) {
    const bearingRad = (r * angleStep) * Math.PI / 180;
    signalGrid[r] = new Float32Array(numSamples);

    const profileElev = new Float64Array(numSamples);
    const profileDist = new Float64Array(numSamples);
    const profilePts = [];

    for (let s = 0; s < numSamples; s++) {
      const dist = (s + 1) * sampleStep;
      const pt = destination(latitude, longitude, bearingRad, dist);
      profileElev[s] = getElevation(pt.lon, pt.lat);
      profileDist[s] = dist;
      profilePts[s] = pt;
    }

    let reflectionFound = false;
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

      // Reflection detection: when ray hits steep terrain with significant diffraction loss
      if (enableReflections && !reflectionFound && s > 0 && diffLoss > BLOCKAGE_THRESHOLD && reflectionBudget > 0) {
        const terrainSlope = Math.atan(Math.abs(profileElev[s] - profileElev[s - 1]) / sampleStep) * 180 / Math.PI;
        if (terrainSlope > MIN_REFLECTOR_SLOPE) {
          reflectionFound = true;
          // Power at the reflection point (one sample before blockage)
          const refDist = profileDist[s - 1];
          const refDistKm = refDist / 1000;
          const refFspl = 20 * Math.log10(refDistKm) + 20 * Math.log10(freq) + 32.44;
          const powerAtReflector = txPowerDbm - refFspl + dampeningDb;
          reflectionQueue.push({
            lat: profilePts[s - 1].lat,
            lon: profilePts[s - 1].lon,
            elevation: profileElev[s - 1],
            incomingBearing: bearingRad,
            powerDbm: powerAtReflector,
            depth: 1,
            parentDist: refDist,
          });
        }
      }
    }
  }

  // Phase 2: Process reflection queue — spawn sub-rays from reflection points
  const reflectedSegments = []; // { originLat, originLon, bearingRad, sampleIndex, pRx, bounceDepth }
  while (reflectionQueue.length > 0 && reflectionBudget > 0) {
    const ref = reflectionQueue.shift();
    const { normalBearing, slopeAngle } = computeSurfaceNormal(ref.lon, ref.lat, getElevation);
    const refBearing = reflectBearing(ref.incomingBearing, normalBearing);
    const refLoss = reflectionLossDb(slopeAngle, freq);
    if (!isFinite(refLoss)) continue;

    const reflectedPower = ref.powerDbm + refLoss;
    if (reflectedPower < -95) continue;

    const remainingDist = radiusMeters - ref.parentDist;
    if (remainingDist < sampleStep) continue;

    const subRaySamples = Math.ceil(remainingDist / sampleStep);
    const halfSpread = (REFLECTION_SPREAD_DEG / 2) * Math.PI / 180;
    const subRayCount = Math.min(REFLECTION_SUB_RAYS, reflectionBudget);

    for (let sr = 0; sr < subRayCount; sr++) {
      reflectionBudget--;
      const fraction = subRayCount > 1 ? sr / (subRayCount - 1) : 0.5;
      const subBearing = refBearing - halfSpread + fraction * 2 * halfSpread;

      // Build sub-ray profile from reflection point
      const subElev = new Float64Array(subRaySamples);
      const subDist = new Float64Array(subRaySamples);
      const subPts = [];
      for (let s = 0; s < subRaySamples; s++) {
        const d = (s + 1) * sampleStep;
        const pt = destination(ref.lat, ref.lon, subBearing, d);
        subElev[s] = getElevation(pt.lon, pt.lat);
        subDist[s] = d;
        subPts[s] = pt;
      }

      const rxHeight = ref.elevation + 1.5; // assume reflection radiates from terrain level
      let subReflectionFound = false;

      for (let s = 0; s < subRaySamples; s++) {
        const d = subDist[s];
        const dKm = d / 1000;
        if (dKm <= 0) continue;
        const segFspl = 20 * Math.log10(dKm) + 20 * Math.log10(freq) + 32.44;
        const rxElev = subElev[s];

        // Diffraction along sub-ray (from reflection point)
        let worstV = -Infinity;
        for (let k = 0; k < s; k++) {
          const d1 = subDist[k];
          const d2 = d - d1;
          if (d1 <= 0 || d2 <= 0) continue;
          const frac = d1 / d;
          const losH = rxHeight + frac * (rxElev - rxHeight);
          const obstH = subElev[k] - losH;
          if (obstH > 0) {
            const v = obstH * Math.sqrt(2 * (d1 + d2) / (lambda * d1 * d2));
            if (v > worstV) worstV = v;
          }
        }

        let diffLoss = 0;
        if (worstV > -0.78) {
          diffLoss = 6.9 + 20 * Math.log10(Math.sqrt(worstV * worstV + 1) + worstV);
          if (diffLoss < 0) diffLoss = 0;
        }

        const pRx = reflectedPower - segFspl - diffLoss;

        if (pRx >= -95) {
          reflectedSegments.push({
            originLat: ref.lat, originLon: ref.lon,
            bearingRad: subBearing, sampleIndex: s,
            sampleStep, pRx, bounceDepth: ref.depth,
          });
        }

        // Double-bounce detection
        if (!subReflectionFound && ref.depth < MAX_BOUNCE_DEPTH && s > 0 && diffLoss > BLOCKAGE_THRESHOLD && reflectionBudget > 0) {
          const slope2 = Math.atan(Math.abs(subElev[s] - subElev[s - 1]) / sampleStep) * 180 / Math.PI;
          if (slope2 > MIN_REFLECTOR_SLOPE) {
            subReflectionFound = true;
            const rd2 = subDist[s - 1];
            const rdKm2 = rd2 / 1000;
            const rFspl2 = 20 * Math.log10(rdKm2) + 20 * Math.log10(freq) + 32.44;
            reflectionQueue.push({
              lat: subPts[s - 1].lat,
              lon: subPts[s - 1].lon,
              elevation: subElev[s - 1],
              incomingBearing: subBearing,
              powerDbm: reflectedPower - rFspl2,
              depth: ref.depth + 1,
              parentDist: ref.parentDist + rd2,
            });
          }
        }
      }
    }
  }

  const features = [];
  const rd = (v) => Math.round(v * 10000) / 10000;

  // Primary ray wedge features
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

  // Reflected ray wedge features
  const refAngleHalf = (REFLECTION_SPREAD_DEG / REFLECTION_SUB_RAYS / 2) * Math.PI / 180;
  for (const seg of reflectedSegments) {
    const { originLat, originLon, bearingRad: segBearing, sampleIndex: s, sampleStep: step, pRx, bounceDepth } = seg;
    const bucket = getBucket(pRx);
    const dNear = s * step;
    const dFar = (s + 1) * step;
    if (dFar <= 0) continue;

    const b1 = segBearing - refAngleHalf;
    const b2 = segBearing + refAngleHalf;

    const p1 = destination(originLat, originLon, b1, Math.max(dNear, 1));
    const p2 = destination(originLat, originLon, b2, Math.max(dNear, 1));
    const p3 = destination(originLat, originLon, b2, dFar);
    const p4 = destination(originLat, originLon, b1, dFar);

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
        reflected: true,
        bounceDepth,
      },
    });
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
