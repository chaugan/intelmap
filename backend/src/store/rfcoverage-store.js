import crypto from 'crypto';
import { getDb } from '../db/index.js';

export function addRFCoverage(projectId, data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_rf_coverages (id, project_id, layer_id, longitude, latitude, antenna_height, tx_power_watts, frequency_mhz, radius_km, geojson, stats, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, projectId, data.layerId || null,
    data.longitude, data.latitude,
    data.antennaHeight, data.txPowerWatts,
    data.frequencyMHz, data.radiusKm,
    JSON.stringify(data.geojson),
    JSON.stringify(data.stats),
    data.createdBy || '',
    now
  );
  return {
    id, projectId,
    layerId: data.layerId || null,
    longitude: data.longitude,
    latitude: data.latitude,
    antennaHeight: data.antennaHeight,
    txPowerWatts: data.txPowerWatts,
    frequencyMHz: data.frequencyMHz,
    radiusKm: data.radiusKm,
    geojson: data.geojson,
    stats: data.stats,
    createdBy: data.createdBy || '',
    createdAt: now,
  };
}

export function getRFCoverages(projectId) {
  const db = getDb();
  return db.prepare('SELECT * FROM project_rf_coverages WHERE project_id = ?')
    .all(projectId)
    .map(rowToRFCoverage);
}

export function deleteRFCoverage(id, projectId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_rf_coverages WHERE id = ? AND project_id = ?').run(id, projectId);
  return result.changes > 0;
}

export function deleteAllRFCoverages(projectId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_rf_coverages WHERE project_id = ?').run(projectId);
  return result.changes;
}

function rowToRFCoverage(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    layerId: row.layer_id || null,
    longitude: row.longitude,
    latitude: row.latitude,
    antennaHeight: row.antenna_height,
    txPowerWatts: row.tx_power_watts,
    frequencyMHz: row.frequency_mhz,
    radiusKm: row.radius_km,
    geojson: tryParseJson(row.geojson, null),
    stats: tryParseJson(row.stats, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function tryParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
