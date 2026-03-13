import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { buildTileMap, destination } from './dem-utils.js';

const router = Router();
router.use(requireAuth);

// Mils to radians (NATO: 6400 mils = 2π)
function milsToRad(mils) {
  return mils * (Math.PI / 3200);
}

// Required elevation angles to hit target at horizontal distance d with altitude diff dh
function requiredElevations(v0, d, dh, g = 9.81) {
  const v2 = v0 * v0;
  const discriminant = v2 * v2 - g * (g * d * d + 2 * dh * v2);
  if (discriminant < 0) return null; // unreachable
  const sq = Math.sqrt(discriminant);
  return {
    thetaHigh: Math.atan2(v2 + sq, g * d),
    thetaLow: Math.atan2(v2 - sq, g * d),
  };
}

// Shell altitude at intermediate horizontal distance x
function trajectoryHeight(x, theta, v0, gunAlt, g = 9.81) {
  const cosT = Math.cos(theta);
  return gunAlt + x * Math.tan(theta) - (g * x * x) / (2 * v0 * v0 * cosT * cosT);
}

// Check if a trajectory at angle theta clears all intermediate terrain
function clearsTerrain(theta, v0, gunAlt, gunLat, gunLon, bearingRad, totalDist, getElevation, traceStep = 200) {
  const numChecks = Math.floor(totalDist / traceStep);
  for (let i = 1; i <= numChecks; i++) {
    const x = i * traceStep;
    if (x >= totalDist) break;
    const shellAlt = trajectoryHeight(x, theta, v0, gunAlt);
    const pt = destination(gunLat, gunLon, bearingRad, x);
    const terrainElev = getElevation(pt.lon, pt.lat);
    if (terrainElev > shellAlt) return false;
  }
  return true;
}

router.post('/calculate', async (req, res) => {
  try {
    const { longitude, latitude, maxRangeKm: rawRange, minElevationMils, maxElevationMils, muzzleVelocity, gunAltitudeOverride } = req.body;

    if (!isFinite(longitude) || !isFinite(latitude)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }
    const maxRangeKm = Math.max(1, Math.min(50, Number(rawRange) || 20));
    const maxRangeM = maxRangeKm * 1000;
    const v0 = Math.max(50, Math.min(1500, Number(muzzleVelocity) || 563));
    const minElRad = milsToRad(Math.max(0, Number(minElevationMils) || 53));
    const maxElRad = milsToRad(Math.min(1600, Number(maxElevationMils) || 1200));

    const { tileMap, getElevation } = await buildTileMap(latitude, longitude, maxRangeKm);

    if (tileMap.size === 0) {
      return res.status(502).json({ error: 'Failed to fetch elevation data' });
    }

    const gunAlt = (gunAltitudeOverride != null && isFinite(gunAltitudeOverride))
      ? Number(gunAltitudeOverride)
      : getElevation(longitude, latitude);

    const numRays = 720;
    const sampleStep = maxRangeKm > 20 ? 100 : maxRangeKm > 5 ? 50 : 30;
    const numSamples = Math.ceil(maxRangeM / sampleStep);

    // 0=unreachable, 1=reachable, 2=dead-zone, 3=terrain-masked
    const grid = new Array(numRays);

    for (let r = 0; r < numRays; r++) {
      const bearingDeg = r * 0.5;
      const bearingRad = bearingDeg * Math.PI / 180;
      grid[r] = new Uint8Array(numSamples);

      for (let s = 1; s <= numSamples; s++) {
        const dist = s * sampleStep;
        if (dist > maxRangeM) break;

        const pt = destination(latitude, longitude, bearingRad, dist);
        const targetElev = getElevation(pt.lon, pt.lat);
        const dh = targetElev - gunAlt;

        const elev = requiredElevations(v0, dist, dh);
        if (!elev) {
          // Beyond ballistic range
          grid[r][s - 1] = 0;
          continue;
        }

        const { thetaHigh, thetaLow } = elev;

        // Check if either solution falls within weapon's elevation limits
        const highValid = thetaHigh >= minElRad && thetaHigh <= maxElRad;
        const lowValid = thetaLow >= minElRad && thetaLow <= maxElRad;

        if (!highValid && !lowValid) {
          // Dead zone: too close — low angle below min elevation, high angle above max elevation
          if (thetaLow < minElRad && thetaHigh > maxElRad) {
            grid[r][s - 1] = 2; // dead zone
          } else {
            grid[r][s - 1] = 0; // unreachable
          }
          continue;
        }

        // Check terrain clearance for valid solutions
        let reachable = false;

        if (highValid && clearsTerrain(thetaHigh, v0, gunAlt, latitude, longitude, bearingRad, dist, getElevation)) {
          reachable = true;
        }
        if (!reachable && lowValid && clearsTerrain(thetaLow, v0, gunAlt, latitude, longitude, bearingRad, dist, getElevation)) {
          reachable = true;
        }

        grid[r][s - 1] = reachable ? 1 : 3; // 1=reachable, 3=terrain-masked
      }
    }

    // Convert to GeoJSON FeatureCollection with zone polygons
    const features = [];
    const angleStep = 0.5;

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
