import { Router } from 'express';

const router = Router();
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// --- Utility functions ---

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Douglas-Peucker simplification */
function simplifyLine(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;

  function perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag === 0) return Math.sqrt((point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2);
    const u = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (mag * mag);
    const ix = lineStart[0] + u * dx;
    const iy = lineStart[1] + u * dy;
    return Math.sqrt((point[0] - ix) ** 2 + (point[1] - iy) ** 2);
  }

  function dpSimplify(points, epsilon) {
    let maxDist = 0;
    let index = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > epsilon) {
      const left = dpSimplify(points.slice(0, index + 1), epsilon);
      const right = dpSimplify(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [points[0], points[points.length - 1]];
  }

  // Binary search for the right epsilon to get ~maxPoints
  let lo = 0, hi = 1;
  let result = coords;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    result = dpSimplify(coords, mid);
    if (result.length > maxPoints) lo = mid;
    else hi = mid;
  }
  return result;
}

/** Subsample to N evenly spaced points along a polyline */
function subsampleLine(coords, n) {
  if (coords.length <= n) return coords;

  // Calculate cumulative distances
  const distances = [0];
  for (let i = 1; i < coords.length; i++) {
    distances.push(distances[i - 1] + haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
  }
  const totalDist = distances[distances.length - 1];
  if (totalDist === 0) return [coords[0], coords[coords.length - 1]];

  const result = [coords[0]];
  let segIdx = 0;
  for (let i = 1; i < n - 1; i++) {
    const targetDist = (i / (n - 1)) * totalDist;
    while (segIdx < distances.length - 2 && distances[segIdx + 1] < targetDist) segIdx++;
    const segLen = distances[segIdx + 1] - distances[segIdx];
    const t = segLen > 0 ? (targetDist - distances[segIdx]) / segLen : 0;
    result.push([
      coords[segIdx][0] + t * (coords[segIdx + 1][0] - coords[segIdx][0]),
      coords[segIdx][1] + t * (coords[segIdx + 1][1] - coords[segIdx][1]),
    ]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

/** Fetch elevation from Geonorge */
async function fetchElevation(lon, lat) {
  try {
    const url = `https://ws.geonorge.no/hoydedata/v1/punkt?nord=${lat}&ost=${lon}&koordsys=4258&geession=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.punkter?.[0]?.z ?? data.hoyde ?? null;
  } catch {
    return null;
  }
}

/** Fetch elevations for multiple points in batches */
async function fetchElevationsBatch(points, concurrency = 25) {
  const results = new Array(points.length).fill(null);
  for (let b = 0; b < points.length; b += concurrency) {
    const batch = points.slice(b, b + concurrency);
    const batchResults = await Promise.all(
      batch.map(([lon, lat]) => fetchElevation(lon, lat))
    );
    for (let i = 0; i < batchResults.length; i++) {
      results[b + i] = batchResults[i] ?? 0;
    }
  }
  return results;
}

// --- A* Pathfinding ---

class MinHeap {
  constructor() { this.data = []; }
  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }
  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) { this.data[0] = last; this._sinkDown(0); }
    return top;
  }
  get size() { return this.data.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  _sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

function astarPathfind(grid, gridW, gridH, startIdx, endIdx, elevations, cellLons, cellLats) {
  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  const gScore = new Float64Array(gridW * gridH).fill(Infinity);
  const cameFrom = new Int32Array(gridW * gridH).fill(-1);
  const closed = new Uint8Array(gridW * gridH);

  gScore[startIdx] = 0;

  const endRow = Math.floor(endIdx / gridW);
  const endCol = endIdx % gridW;

  const heap = new MinHeap();
  heap.push({ idx: startIdx, f: haversine(cellLons[startIdx], cellLats[startIdx], cellLons[endIdx], cellLats[endIdx]) });

  while (heap.size > 0) {
    const { idx: current } = heap.pop();
    if (current === endIdx) break;
    if (closed[current]) continue;
    closed[current] = 1;

    const row = Math.floor(current / gridW);
    const col = current % gridW;

    for (const [dr, dc] of dirs) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= gridH || nc < 0 || nc >= gridW) continue;
      const neighbor = nr * gridW + nc;
      if (closed[neighbor]) continue;

      const dist = haversine(cellLons[current], cellLats[current], cellLons[neighbor], cellLats[neighbor]);
      const elevDiff = Math.abs(elevations[neighbor] - elevations[current]);
      const horizontalDist = dist * 1000; // meters
      const slopeDeg = Math.atan2(elevDiff, horizontalDist) * (180 / Math.PI);

      // Impassable if slope > 35 degrees
      if (slopeDeg > 35) continue;

      const slopePenalty = (slopeDeg / 15) ** 2;
      const elevPenalty = Math.max(0, elevations[neighbor] - 500) / 2000;
      const cost = dist * (1 + slopePenalty + elevPenalty);

      const tentative = gScore[current] + cost;
      if (tentative < gScore[neighbor]) {
        gScore[neighbor] = tentative;
        cameFrom[neighbor] = current;
        const h = haversine(cellLons[neighbor], cellLats[neighbor], cellLons[endIdx], cellLats[endIdx]);
        heap.push({ idx: neighbor, f: tentative + h });
      }
    }
  }

  // Reconstruct path
  if (cameFrom[endIdx] === -1 && startIdx !== endIdx) return null;
  const path = [];
  let cur = endIdx;
  while (cur !== -1) {
    path.push(cur);
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}

/** Smooth path with 3-point moving average */
function smoothPath(coords) {
  if (coords.length <= 2) return coords;
  const result = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    result.push([
      (coords[i - 1][0] + coords[i][0] + coords[i + 1][0]) / 3,
      (coords[i - 1][1] + coords[i][1] + coords[i + 1][1]) / 3,
    ]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

// --- Endpoints ---

/**
 * GET /api/route/road
 * Road routing via OSRM
 */
router.get('/road', async (req, res) => {
  try {
    const { from, to, via } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required (lon,lat)' });

    const cacheKey = `road:${from}|${to}|${via || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Build coordinate string: from;via1;via2;...;to
    const parts = [from];
    if (via) parts.push(...via.split(';'));
    parts.push(to);
    const coordStr = parts.map(p => p.trim()).join(';');

    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const osrmRes = await fetch(osrmUrl);
    if (!osrmRes.ok) throw new Error(`OSRM error ${osrmRes.status}`);
    const osrmData = await osrmRes.json();

    if (osrmData.code !== 'Ok' || !osrmData.routes?.length) {
      return res.status(404).json({ error: 'No route found' });
    }

    const route = osrmData.routes[0];
    let coordinates = route.geometry.coordinates;

    // Simplify if too many points
    if (coordinates.length > 150) {
      coordinates = simplifyLine(coordinates, 150);
    }

    const result = {
      coordinates,
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      durationMin: Math.round(route.duration / 60),
    };

    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/route/terrain
 * Terrain-aware cross-country routing via A* + elevation data
 */
router.get('/terrain', async (req, res) => {
  try {
    const { from, to, via } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required (lon,lat)' });

    const cacheKey = `terrain:${from}|${to}|${via || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Parse waypoints: from, optional via points, to
    const waypoints = [];
    const [fromLon, fromLat] = from.split(',').map(Number);
    waypoints.push([fromLon, fromLat]);
    if (via) {
      for (const v of via.split(';')) {
        const [vLon, vLat] = v.split(',').map(Number);
        waypoints.push([vLon, vLat]);
      }
    }
    const [toLon, toLat] = to.split(',').map(Number);
    waypoints.push([toLon, toLat]);

    // Route through each pair of waypoints
    let fullPath = [];

    for (let seg = 0; seg < waypoints.length - 1; seg++) {
      const [sLon, sLat] = waypoints[seg];
      const [eLon, eLat] = waypoints[seg + 1];

      // Build grid around bounding box (expanded 20%)
      const minLon = Math.min(sLon, eLon);
      const maxLon = Math.max(sLon, eLon);
      const minLat = Math.min(sLat, eLat);
      const maxLat = Math.max(sLat, eLat);
      const lonSpan = maxLon - minLon || 0.1;
      const latSpan = maxLat - minLat || 0.1;
      const expandLon = lonSpan * 0.2;
      const expandLat = latSpan * 0.2;

      const gridW = 25;
      const gridH = 25;
      const gridMinLon = minLon - expandLon;
      const gridMaxLon = maxLon + expandLon;
      const gridMinLat = minLat - expandLat;
      const gridMaxLat = maxLat + expandLat;
      const lonStep = (gridMaxLon - gridMinLon) / (gridW - 1);
      const latStep = (gridMaxLat - gridMinLat) / (gridH - 1);

      // Build grid points
      const cellLons = new Float64Array(gridW * gridH);
      const cellLats = new Float64Array(gridW * gridH);
      const gridPoints = [];
      for (let r = 0; r < gridH; r++) {
        for (let c = 0; c < gridW; c++) {
          const idx = r * gridW + c;
          cellLons[idx] = gridMinLon + c * lonStep;
          cellLats[idx] = gridMinLat + r * latStep;
          gridPoints.push([cellLons[idx], cellLats[idx]]);
        }
      }

      // Fetch elevations
      const elevations = await fetchElevationsBatch(gridPoints, 25);

      // Find nearest grid cell to start and end
      let startIdx = 0, endIdx = 0;
      let minStartDist = Infinity, minEndDist = Infinity;
      for (let i = 0; i < gridPoints.length; i++) {
        const dStart = haversine(gridPoints[i][0], gridPoints[i][1], sLon, sLat);
        const dEnd = haversine(gridPoints[i][0], gridPoints[i][1], eLon, eLat);
        if (dStart < minStartDist) { minStartDist = dStart; startIdx = i; }
        if (dEnd < minEndDist) { minEndDist = dEnd; endIdx = i; }
      }

      // Run A*
      const pathIndices = astarPathfind(null, gridW, gridH, startIdx, endIdx, elevations, cellLons, cellLats);
      if (!pathIndices) {
        return res.status(404).json({ error: 'No passable terrain route found' });
      }

      // Convert to coordinates
      let segCoords = pathIndices.map(i => [cellLons[i], cellLats[i]]);

      // Prepend actual start, append actual end
      segCoords[0] = [sLon, sLat];
      segCoords[segCoords.length - 1] = [eLon, eLat];

      // Smooth
      segCoords = smoothPath(smoothPath(segCoords));

      // Append to full path (skip first point of subsequent segments to avoid duplicates)
      if (seg === 0) {
        fullPath.push(...segCoords);
      } else {
        fullPath.push(...segCoords.slice(1));
      }
    }

    // Subsample to ~80 points
    fullPath = subsampleLine(fullPath, 80);

    // Build elevation profile for the final path
    const profileElevations = await fetchElevationsBatch(fullPath, 10);
    let cumulativeDist = 0;
    const elevationProfile = fullPath.map((coord, i) => {
      if (i > 0) {
        cumulativeDist += haversine(fullPath[i - 1][0], fullPath[i - 1][1], coord[0], coord[1]);
      }
      return {
        lon: coord[0],
        lat: coord[1],
        elevation: profileElevations[i],
        distanceKm: Math.round(cumulativeDist * 10) / 10,
      };
    });

    // Calculate total distance
    let totalDist = 0;
    for (let i = 1; i < fullPath.length; i++) {
      totalDist += haversine(fullPath[i - 1][0], fullPath[i - 1][1], fullPath[i][0], fullPath[i][1]);
    }

    const result = {
      coordinates: fullPath,
      distanceKm: Math.round(totalDist * 10) / 10,
      elevationProfile,
    };

    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/route/elevation-profile
 * Elevation profile for a series of waypoints
 */
router.get('/elevation-profile', async (req, res) => {
  try {
    const { coordinates } = req.query;
    if (!coordinates) return res.status(400).json({ error: 'coordinates required (lon,lat;lon,lat;...)' });

    const waypoints = coordinates.split(';').map(p => {
      const [lon, lat] = p.split(',').map(Number);
      return [lon, lat];
    });

    // Interpolate ~50 evenly spaced sample points along the polyline
    const samplePoints = subsampleLine(waypoints, 50);

    // Fetch elevations
    const elevations = await fetchElevationsBatch(samplePoints, 10);

    let cumulativeDist = 0;
    let totalClimb = 0;
    let maxElev = -Infinity;
    let minElev = Infinity;

    const points = samplePoints.map((coord, i) => {
      if (i > 0) {
        cumulativeDist += haversine(samplePoints[i - 1][0], samplePoints[i - 1][1], coord[0], coord[1]);
        const diff = elevations[i] - elevations[i - 1];
        if (diff > 0) totalClimb += diff;
      }
      if (elevations[i] > maxElev) maxElev = elevations[i];
      if (elevations[i] < minElev) minElev = elevations[i];

      return {
        lon: coord[0],
        lat: coord[1],
        elevation: elevations[i],
        distanceKm: Math.round(cumulativeDist * 10) / 10,
      };
    });

    res.json({
      points,
      maxElevation: maxElev,
      minElevation: minElev,
      totalClimb: Math.round(totalClimb),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
