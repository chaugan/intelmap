import crypto from 'crypto';
import { getDb } from '../db/index.js';

export function addFiringRange(projectId, data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_firing_ranges (id, project_id, layer_id, longitude, latitude, gun_altitude, weapon_preset, max_range_km, min_elevation_mils, max_elevation_mils, muzzle_velocity, geojson, stats, color, label, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, projectId, data.layerId || null,
    data.longitude, data.latitude,
    data.gunAltitude || 0,
    data.weaponPreset || 'custom',
    data.maxRangeKm, data.minElevationMils, data.maxElevationMils,
    data.muzzleVelocity,
    JSON.stringify(data.geojson),
    JSON.stringify(data.stats),
    data.color || null,
    data.label || null,
    data.createdBy || '',
    now
  );
  return {
    id, projectId,
    layerId: data.layerId || null,
    longitude: data.longitude,
    latitude: data.latitude,
    gunAltitude: data.gunAltitude || 0,
    weaponPreset: data.weaponPreset || 'custom',
    maxRangeKm: data.maxRangeKm,
    minElevationMils: data.minElevationMils,
    maxElevationMils: data.maxElevationMils,
    muzzleVelocity: data.muzzleVelocity,
    geojson: data.geojson,
    stats: data.stats,
    color: data.color || null,
    label: data.label || null,
    createdBy: data.createdBy || '',
    createdAt: now,
  };
}

export function getFiringRanges(projectId) {
  const db = getDb();
  return db.prepare('SELECT * FROM project_firing_ranges WHERE project_id = ?')
    .all(projectId)
    .map(rowToFiringRange);
}

export function deleteFiringRange(id, projectId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_firing_ranges WHERE id = ? AND project_id = ?').run(id, projectId);
  return result.changes > 0;
}

export function deleteAllFiringRanges(projectId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_firing_ranges WHERE project_id = ?').run(projectId);
  return result.changes;
}

export function updateFiringRange(id, projectId, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  const allowed = {
    color: 'color', label: 'label', longitude: 'longitude', latitude: 'latitude',
    gunAltitude: 'gun_altitude', weaponPreset: 'weapon_preset',
    maxRangeKm: 'max_range_km', minElevationMils: 'min_elevation_mils',
    maxElevationMils: 'max_elevation_mils', muzzleVelocity: 'muzzle_velocity',
    geojson: 'geojson', stats: 'stats',
  };
  for (const [key, col] of Object.entries(allowed)) {
    if (updates[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push((key === 'geojson' || key === 'stats') ? JSON.stringify(updates[key]) : updates[key]);
    }
  }
  if (fields.length === 0) return null;
  values.push(id, projectId);
  db.prepare(`UPDATE project_firing_ranges SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM project_firing_ranges WHERE id = ? AND project_id = ?').get(id, projectId);
  return row ? rowToFiringRange(row) : null;
}

function rowToFiringRange(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    layerId: row.layer_id || null,
    longitude: row.longitude,
    latitude: row.latitude,
    gunAltitude: row.gun_altitude,
    weaponPreset: row.weapon_preset,
    maxRangeKm: row.max_range_km,
    minElevationMils: row.min_elevation_mils,
    maxElevationMils: row.max_elevation_mils,
    muzzleVelocity: row.muzzle_velocity,
    geojson: tryParseJson(row.geojson, null),
    stats: tryParseJson(row.stats, {}),
    color: row.color || null,
    label: row.label || null,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function tryParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
