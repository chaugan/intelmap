import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { buildTileMap, destination } from './dem-utils.js';
import {
  milsToRad, requiredElevations, clearsTerrain,
  rocketRequiredElevations, rocketClearsTerrain,
} from './ballistics.js';

const router = Router();
router.use(requireAuth);

// ---- Main calculation endpoint ----

router.post('/calculate', async (req, res) => {
  try {
    const { longitude, latitude, maxRangeKm: rawRange, minElevationMils, maxElevationMils, muzzleVelocity, gunAltitudeOverride } = req.body;

    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    const maxRangeKm = Math.max(1, Math.min(50, Number(rawRange) || 20));
    const maxRangeM = maxRangeKm * 1000;
    const v0 = Math.max(50, Math.min(1500, Number(muzzleVelocity) || 563));
    const minElRad = milsToRad(Math.max(-200, Number(minElevationMils) || 53));
    const maxElRad = milsToRad(Math.min(1600, Number(maxElevationMils) || 1200));

    // Rocket parameters
    const isRocket = !!req.body.isRocket;
    const burnTime = isRocket ? Math.max(0.1, Math.min(10, Number(req.body.burnTime) || 1.5)) : 0;
    const launchVelocity = isRocket ? Math.max(0, Math.min(500, Number(req.body.launchVelocity) || 30)) : 0;
    const burnoutVelocity = isRocket ? Math.max(50, Math.min(2000, Number(req.body.burnoutVelocity) || 500)) : 0;
    const thrustAccel = isRocket ? (burnoutVelocity - launchVelocity) / burnTime : 0;

    const { tileMap, getElevation } = await buildTileMap(latitude, longitude, maxRangeKm);

    if (tileMap.size === 0) {
      return res.status(502).json({ error: 'Failed to fetch elevation data' });
    }

    const gunAlt = (gunAltitudeOverride != null && isFinite(gunAltitudeOverride))
      ? Number(gunAltitudeOverride)
      : getElevation(longitude, latitude);

    const numRays = 720;
    const angleStep = 0.5;
    const sampleStep = maxRangeKm > 20 ? 100 : maxRangeKm > 5 ? 50 : 30;
    const numSamples = Math.ceil(maxRangeM / sampleStep);

    // 0=unreachable, 1=reachable, 2=dead-zone, 3=terrain-masked
    const grid = new Array(numRays);

    for (let r = 0; r < numRays; r++) {
      const bearingDeg = r * angleStep;
      const bearingRad = bearingDeg * Math.PI / 180;
      grid[r] = new Uint8Array(numSamples);

      for (let s = 1; s <= numSamples; s++) {
        const dist = s * sampleStep;
        if (dist > maxRangeM) break;

        const pt = destination(latitude, longitude, bearingRad, dist);
        const targetElev = getElevation(pt.lon, pt.lat);
        const dh = targetElev - gunAlt;

        let elev;
        if (isRocket) {
          elev = rocketRequiredElevations(launchVelocity, thrustAccel, burnTime, dist, dh, minElRad, maxElRad);
        } else {
          elev = requiredElevations(v0, dist, dh);
        }

        if (!elev) {
          grid[r][s - 1] = 0;
          continue;
        }

        const { thetaHigh, thetaLow } = elev;

        // Check if either solution falls within weapon's elevation limits
        const highValid = thetaHigh >= minElRad && thetaHigh <= maxElRad;
        const lowValid = thetaLow >= minElRad && thetaLow <= maxElRad;

        if (!highValid && !lowValid) {
          if (thetaLow < minElRad && thetaHigh > maxElRad) {
            grid[r][s - 1] = 2; // dead zone
          } else {
            grid[r][s - 1] = 0; // unreachable
          }
          continue;
        }

        // Check terrain clearance for valid solutions
        let reachable = false;

        if (isRocket) {
          if (highValid && rocketClearsTerrain(thetaHigh, launchVelocity, thrustAccel, burnTime, gunAlt, latitude, longitude, bearingRad, dist, getElevation, destination)) {
            reachable = true;
          }
          if (!reachable && lowValid && rocketClearsTerrain(thetaLow, launchVelocity, thrustAccel, burnTime, gunAlt, latitude, longitude, bearingRad, dist, getElevation, destination)) {
            reachable = true;
          }
        } else {
          if (highValid && clearsTerrain(thetaHigh, v0, gunAlt, latitude, longitude, bearingRad, dist, getElevation, destination)) {
            reachable = true;
          }
          if (!reachable && lowValid && clearsTerrain(thetaLow, v0, gunAlt, latitude, longitude, bearingRad, dist, getElevation, destination)) {
            reachable = true;
          }
        }

        grid[r][s - 1] = reachable ? 1 : 3; // 1=reachable, 3=terrain-masked
      }
    }

    // Convert to GeoJSON FeatureCollection with zone polygons
    const features = [];

    for (let r = 0; r < numRays; r++) {
      let startSample = -1;
      let currentType = 0;

      for (let s = 0; s <= numSamples; s++) {
        const val = s < numSamples ? grid[r][s] : 0;

        if (val !== 0 && startSample === -1) {
          startSample = s;
          currentType = val;
        } else if ((val !== currentType || val === 0) && startSample !== -1) {
          // Emit wedge
          const bearing1 = (r * angleStep - angleStep / 2) * Math.PI / 180;
          const bearing2 = (r * angleStep + angleStep / 2) * Math.PI / 180;
          const dNear = (startSample + 1) * sampleStep;
          const dFar = s * sampleStep;

          const p1 = destination(latitude, longitude, bearing1, dNear);
          const p2 = destination(latitude, longitude, bearing2, dNear);
          const p3 = destination(latitude, longitude, bearing2, dFar);
          const p4 = destination(latitude, longitude, bearing1, dFar);

          const zoneNames = { 1: 'reachable', 2: 'dead', 3: 'masked' };
          features.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [[[p1.lon, p1.lat], [p2.lon, p2.lat], [p3.lon, p3.lat], [p4.lon, p4.lat], [p1.lon, p1.lat]]] },
            properties: { zone: zoneNames[currentType] || 'unreachable' },
          });

          if (val !== 0) {
            startSample = s;
            currentType = val;
          } else {
            startSample = -1;
            currentType = 0;
          }
        }
      }
    }

    // Range rings at 25%, 50%, 75%, 100%
    for (const pct of [0.25, 0.5, 0.75, 1.0]) {
      const ringDist = maxRangeKm * pct;
      const ringDistM = ringDist * 1000;
      const coords = [];
      for (let i = 0; i <= 64; i++) {
        const bearing = (2 * Math.PI * i) / 64;
        const pt = destination(latitude, longitude, bearing, ringDistM);
        coords.push([pt.lon, pt.lat]);
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { type: 'range-ring', distanceKm: Math.round(ringDist * 10) / 10, percent: pct * 100 },
      });
    }

    // Stats
    let reachableCount = 0, deadCount = 0, maskedCount = 0, totalCount = 0;
    for (let r = 0; r < numRays; r++) {
      for (let s = 0; s < numSamples; s++) {
        const dist = (s + 1) * sampleStep;
        if (dist > maxRangeM) break;
        totalCount++;
        if (grid[r][s] === 1) reachableCount++;
        else if (grid[r][s] === 2) deadCount++;
        else if (grid[r][s] === 3) maskedCount++;
      }
    }

    const totalAreaKm2 = Math.PI * maxRangeKm * maxRangeKm;
    const reachablePercent = totalCount > 0 ? Math.round(reachableCount / totalCount * 100) : 0;
    const reachableAreaKm2 = Math.round(totalAreaKm2 * reachablePercent / 100 * 100) / 100;

    // Estimate dead zone radius (average distance of dead zone samples)
    let deadDistSum = 0, deadDistCount = 0;
    for (let r = 0; r < numRays; r++) {
      for (let s = 0; s < numSamples; s++) {
        if (grid[r][s] === 2) {
          deadDistSum += (s + 1) * sampleStep;
          deadDistCount++;
        }
      }
    }
    const deadZoneRadiusKm = deadDistCount > 0 ? Math.round(deadDistSum / deadDistCount / 100) / 10 : 0;

    const geojson = { type: 'FeatureCollection', features };

    res.json({
      geojson,
      stats: {
        reachablePercent,
        reachableAreaKm2,
        deadZoneRadiusKm,
        totalAreaKm2: Math.round(totalAreaKm2 * 100) / 100,
      },
      groundElevation: Math.round(gunAlt),
    });
  } catch (err) {
    console.error('Firing range calculation error:', err);
    res.status(500).json({ error: 'Firing range calculation failed' });
  }
});

export default router;
