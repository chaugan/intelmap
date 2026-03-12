import crypto from 'crypto';
import { getDb } from '../db/index.js';

export function addViewshed(projectId, data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const type = data.type || 'viewshed';
  db.prepare(
    `INSERT INTO project_viewsheds (id, project_id, layer_id, longitude, latitude, observer_height, radius_km, geojson, stats, created_by, created_at, type, color, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, projectId, data.layerId || null,
    data.longitude, data.latitude,
    data.observerHeight, data.radiusKm,
    JSON.stringify(data.geojson),
    JSON.stringify(data.stats),
    data.createdBy || '',
    now, type,
    data.color || null,
    data.label || null
  );
  return {
    id, projectId,
    layerId: data.layerId || null,
    type,
    longitude: data.longitude,
    latitude: data.latitude,
    observerHeight: data.observerHeight,
    radiusKm: data.radiusKm,
    geojson: data.geojson,
    stats: data.stats,
    createdBy: data.createdBy || '',
    createdAt: now,
    color: data.color || null,
    label: data.label || null,
  };
}

export function getViewsheds(projectId) {
  const db = getDb();
  return db.prepare('SELECT * FROM project_viewsheds WHERE project_id = ?')
    .all(projectId)
    .map(rowToViewshed);
}

export function deleteViewshed(id, projectId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_viewsheds WHERE id = ? AND project_id = ?').run(id, projectId);
  return result.changes > 0;
}

export function deleteAllViewsheds(projectId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM project_viewsheds WHERE project_id = ?').run(projectId);
  return result.changes;
}

export function updateViewshed(id, projectId, updates) {
  const db = getDb();
  const fields = [];
  const values = [];
  const allowed = { color: 'color', label: 'label', longitude: 'longitude', latitude: 'latitude', observerHeight: 'observer_height', radiusKm: 'radius_km', geojson: 'geojson', stats: 'stats' };
  for (const [key, col] of Object.entries(allowed)) {
    if (updates[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push((key === 'geojson' || key === 'stats') ? JSON.stringify(updates[key]) : updates[key]);
    }
  }
  if (fields.length === 0) return null;
  values.push(id, projectId);
  db.prepare(`UPDATE project_viewsheds SET ${fields.join(', ')} WHERE id = ? AND project_id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM project_viewsheds WHERE id = ? AND project_id = ?').get(id, projectId);
  return row ? rowToViewshed(row) : null;
}

function rowToViewshed(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    layerId: row.layer_id || null,
    type: row.type || 'viewshed',
    longitude: row.longitude,
    latitude: row.latitude,
    observerHeight: row.observer_height,
    radiusKm: row.radius_km,
    geojson: tryParseJson(row.geojson, null),
    stats: tryParseJson(row.stats, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    color: row.color || null,
    label: row.label || null,
  };
}

function tryParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
