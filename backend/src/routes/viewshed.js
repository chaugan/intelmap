import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  buildTileMap,
  destination,
} from './dem-utils.js';

const router = Router();
router.use(requireAuth);

router.post('/calculate-horizon', async (req, res) => {
  try {
    const { longitude, latitude, radiusKm: rawRadius } = req.body;

    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    const radius = Math.max(1, Math.min(30, Number(rawRadius) || 15));
    const radiusMeters = radius * 1000;

    const { tileMap, getElevation } = await buildTileMap(latitude, longitude, radius);

    if (tileMap.size === 0) {
      return res.status(502).json({ error: 'Failed to fetch elevation data' });
    }

    const groundElevation = getElevation(longitude, latitude);
    const sampleStep = radius > 10 ? 100 : radius > 3 ? 50 : 30;
    const numSamples = Math.ceil(radiusMeters / sampleStep);
    const numRays = 720;
    const horizonProfile = new Float64Array(numRays);

    for (let r = 0; r < numRays; r++) {
      const bearingRad = (r * 0.5) * Math.PI / 180;
      let maxAngle = 0;

      for (let s = 1; s <= numSamples; s++) {
        const dist = s * sampleStep;
        const pt = destination(latitude, longitude, bearingRad, dist);
        const terrainElev = getElevation(pt.lon, pt.lat);
        const elevAngle = Math.atan2(terrainElev - groundElevation, dist) * 180 / Math.PI;
        if (elevAngle > maxAngle) maxAngle = elevAngle;
      }
      horizonProfile[r] = Math.round(maxAngle * 100) / 100;
    }

    // Stats
    let sum = 0, max = 0, exposedCount = 0;
    const exposureThreshold = 5;
    for (let i = 0; i < numRays; i++) {
      sum += horizonProfile[i];
      if (horizonProfile[i] > max) max = horizonProfile[i];
      if (horizonProfile[i] < exposureThreshold) exposedCount++;
    }

    res.json({
      horizonProfile: Array.from(horizonProfile),
      stats: {
        exposurePercent: Math.round(exposedCount / numRays * 100),
        meanHorizonAngleDeg: Math.round(sum / numRays * 100) / 100,
        maxHorizonAngleDeg: max,
      },
      groundElevation: Math.round(groundElevation),
    });
  } catch (err) {
    console.error('Horizon calculation error:', err);
    res.status(500).json({ error: 'Horizon calculation failed' });
  }
});

router.post('/calculate', async (req, res) => {
  try {
    const { longitude, latitude, observerHeight, radiusKm } = req.body;

    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    const height = Math.max(1, Math.min(100, Number(observerHeight) || 5));
    const radius = Math.max(0.5, Math.min(50, Number(radiusKm) || 5));
    const radiusMeters = radius * 1000;

    const { tileMap, getElevation } = await buildTileMap(latitude, longitude, radius);

    if (tileMap.size === 0) {
      return res.status(502).json({ error: 'Failed to fetch elevation data' });
    }

    const groundElevation = getElevation(longitude, latitude);
    const observerElevation = groundElevation + height;

    const numRays = 720;
    const sampleStep = radius > 10 ? 100 : radius > 3 ? 50 : 30;
    const numSamples = Math.ceil(radiusMeters / sampleStep);

    const visibilityGrid = new Array(numRays);

    for (let r = 0; r < numRays; r++) {
      const bearingDeg = r * 0.5;
      const bearingRad = bearingDeg * Math.PI / 180;
      visibilityGrid[r] = new Uint8Array(numSamples);
      let maxAngle = -Infinity;

      for (let s = 1; s <= numSamples; s++) {
        const dist = s * sampleStep;
        const pt = destination(latitude, longitude, bearingRad, dist);
        const terrainElev = getElevation(pt.lon, pt.lat);
        const elevAngle = Math.atan2(terrainElev - observerElevation, dist);

        if (elevAngle > maxAngle) {
          visibilityGrid[r][s - 1] = 1;
          maxAngle = elevAngle;
        }
      }
    }

    // Convert to GeoJSON
    const visiblePolygons = [];
    const angleStep = 0.5;

    for (let r = 0; r < numRays; r++) {
      let startSample = -1;

      for (let s = 0; s <= numSamples; s++) {
        const vis = s < numSamples ? visibilityGrid[r][s] : 0;

        if (vis && startSample === -1) {
          startSample = s;
        } else if (!vis && startSample !== -1) {
          const bearing1 = (r * angleStep - angleStep / 2) * Math.PI / 180;
          const bearing2 = (r * angleStep + angleStep / 2) * Math.PI / 180;
          const dNear = (startSample + 1) * sampleStep;
          const dFar = s * sampleStep;

          const p1 = destination(latitude, longitude, bearing1, dNear);
          const p2 = destination(latitude, longitude, bearing2, dNear);
          const p3 = destination(latitude, longitude, bearing2, dFar);
          const p4 = destination(latitude, longitude, bearing1, dFar);

          visiblePolygons.push([[
            [p1.lon, p1.lat],
            [p2.lon, p2.lat],
            [p3.lon, p3.lat],
            [p4.lon, p4.lat],
            [p1.lon, p1.lat],
          ]]);
          startSample = -1;
        }
      }
    }

    let visibleCount = 0;
    let totalCount = 0;
    for (let r = 0; r < numRays; r++) {
      for (let s = 0; s < numSamples; s++) {
        totalCount++;
        if (visibilityGrid[r][s]) visibleCount++;
      }
    }

    const totalAreaKm2 = Math.PI * radius * radius;
    const visiblePercent = totalCount > 0 ? Math.round(visibleCount / totalCount * 100) : 0;
    const visibleAreaKm2 = Math.round(totalAreaKm2 * visiblePercent / 100 * 100) / 100;

    const geojson = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: visiblePolygons,
      },
      properties: {
        observerLon: longitude,
        observerLat: latitude,
        observerHeight: height,
        radiusKm: radius,
      },
    };

    res.json({
      geojson,
      stats: {
        visiblePercent,
        visibleAreaKm2,
        totalAreaKm2: Math.round(totalAreaKm2 * 100) / 100,
      },
      observerElevation: Math.round(groundElevation),
    });
  } catch (err) {
    console.error('Viewshed calculation error:', err);
    res.status(500).json({ error: 'Viewshed calculation failed' });
  }
});

export default router;
