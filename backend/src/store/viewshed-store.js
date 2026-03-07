import crypto from 'crypto';
import { getDb } from '../db/index.js';

export function addViewshed(projectId, data) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_viewsheds (id, project_id, longitude, latitude, observer_height, radius_km, geojson, stats, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, projectId,
    data.longitude, data.latitude,
    data.observerHeight, data.radiusKm,
    JSON.stringify(data.geojson),
    JSON.stringify(data.stats),
    data.createdBy || '',
    now
  );
  return {
    id, projectId,
    longitude: data.longitude,
    latitude: data.latitude,
    observerHeight: data.observerHeight,
    radiusKm: data.radiusKm,
    geojson: data.geojson,
    stats: data.stats,
    createdBy: data.createdBy || '',
    createdAt: now,
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

function rowToViewshed(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    longitude: row.longitude,
    latitude: row.latitude,
    observerHeight: row.observer_height,
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
