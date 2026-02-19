import crypto from 'crypto';
import { getDb } from '../db/index.js';

/**
 * Per-project SQLite-backed store for tactical data.
 * Write-through: every mutation goes directly to SQLite.
 */
export class ProjectStoreManager {
  // --- Project State ---

  getProjectState(projectId) {
    const db = getDb();
    const markers = db.prepare('SELECT * FROM project_markers WHERE project_id = ?').all(projectId).map(rowToMarker);
    const drawings = db.prepare('SELECT * FROM project_drawings WHERE project_id = ?').all(projectId).map(rowToDrawing);
    const layers = db.prepare('SELECT * FROM project_layers WHERE project_id = ?').all(projectId).map(rowToLayer);
    const pins = db.prepare('SELECT * FROM project_pins WHERE project_id = ?').all(projectId).map(rowToPin);
    return { markers, drawings, layers, pins };
  }

  // --- Markers ---

  addMarker(projectId, data) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_markers (id, project_id, layer_id, sidc, lat, lon, designation, higher_formation, additional_info, custom_label, source, created_by, properties, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, data.layerId || null,
      data.sidc || '', data.lat, data.lon,
      data.designation || '', data.higherFormation || '', data.additionalInfo || '',
      data.customLabel || '', data.source || 'user', data.createdBy || '',
      JSON.stringify(data.properties || {}), now, now
    );
    return { ...data, id, type: 'marker', projectId, createdAt: now, updatedAt: now };
  }

  updateMarker(projectId, id, changes) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM project_markers WHERE id = ? AND project_id = ?').get(id, projectId);
    if (!row) return null;

    const updates = {};
    if (changes.lat !== undefined) updates.lat = changes.lat;
    if (changes.lon !== undefined) updates.lon = changes.lon;
    if (changes.sidc !== undefined) updates.sidc = changes.sidc;
    if (changes.designation !== undefined) updates.designation = changes.designation;
    if (changes.higherFormation !== undefined) updates.higher_formation = changes.higherFormation;
    if (changes.additionalInfo !== undefined) updates.additional_info = changes.additionalInfo;
    if (changes.customLabel !== undefined) updates.custom_label = changes.customLabel;
    if (changes.layerId !== undefined) updates.layer_id = changes.layerId;
    if (changes.source !== undefined) updates.source = changes.source;
    if (changes.properties !== undefined) updates.properties = JSON.stringify(changes.properties);

    if (Object.keys(updates).length === 0) return rowToMarker(row);

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(
      `UPDATE project_markers SET ${setClauses}, updated_at = datetime('now') WHERE id = ? AND project_id = ?`
    ).run(...values, id, projectId);

    const updated = db.prepare('SELECT * FROM project_markers WHERE id = ?').get(id);
    return rowToMarker(updated);
  }

  deleteMarker(projectId, id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM project_markers WHERE id = ? AND project_id = ?').run(id, projectId);
    return result.changes > 0;
  }

  // --- Drawings ---

  addDrawing(projectId, data) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_drawings (id, project_id, layer_id, drawing_type, geometry, properties, source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, data.layerId || null,
      data.drawingType || 'line',
      JSON.stringify(data.geometry),
      JSON.stringify(data.properties || {}),
      data.source || 'user', data.createdBy || '', now, now
    );
    return { ...data, id, type: 'drawing', projectId, createdAt: now, updatedAt: now };
  }

  updateDrawing(projectId, id, changes) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM project_drawings WHERE id = ? AND project_id = ?').get(id, projectId);
    if (!row) return null;

    const updates = {};
    if (changes.geometry !== undefined) updates.geometry = JSON.stringify(changes.geometry);
    if (changes.properties !== undefined) updates.properties = JSON.stringify(changes.properties);
    if (changes.drawingType !== undefined) updates.drawing_type = changes.drawingType;
    if (changes.layerId !== undefined) updates.layer_id = changes.layerId;

    if (Object.keys(updates).length === 0) return rowToDrawing(row);

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(
      `UPDATE project_drawings SET ${setClauses}, updated_at = datetime('now') WHERE id = ? AND project_id = ?`
    ).run(...values, id, projectId);

    const updated = db.prepare('SELECT * FROM project_drawings WHERE id = ?').get(id);
    return rowToDrawing(updated);
  }

  deleteDrawing(projectId, id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM project_drawings WHERE id = ? AND project_id = ?').run(id, projectId);
    return result.changes > 0;
  }

  deleteDrawingBatch(projectId, ids) {
    const db = getDb();
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(
      `DELETE FROM project_drawings WHERE id IN (${placeholders}) AND project_id = ?`
    ).run(...ids, projectId);
    return result.changes;
  }

  // --- Layers ---

  addLayer(projectId, data) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO project_layers (id, project_id, name, visible, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, data.name || 'Unnamed', data.visible !== false ? 1 : 0, data.source || 'user', data.createdBy || '', now);
    return { id, projectId, name: data.name || 'Unnamed', visible: true, source: data.source || 'user', createdBy: data.createdBy || '', createdAt: now };
  }

  updateLayer(projectId, id, changes) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM project_layers WHERE id = ? AND project_id = ?').get(id, projectId);
    if (!row) return null;

    const updates = {};
    if (changes.name !== undefined) updates.name = changes.name;
    if (changes.visible !== undefined) updates.visible = changes.visible ? 1 : 0;
    if (changes.source !== undefined) updates.source = changes.source;

    if (Object.keys(updates).length === 0) return rowToLayer(row);

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(
      `UPDATE project_layers SET ${setClauses} WHERE id = ? AND project_id = ?`
    ).run(...values, id, projectId);

    const updated = db.prepare('SELECT * FROM project_layers WHERE id = ?').get(id);
    return rowToLayer(updated);
  }

  deleteLayer(projectId, id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM project_layers WHERE id = ? AND project_id = ?').run(id, projectId);
    return result.changes > 0;
  }
  // --- Pins ---

  addPin(projectId, data) {
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO project_pins (id, project_id, layer_id, pin_type, lat, lon, properties, source, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, projectId, data.layerId || null,
      data.pinType || 'context',
      data.lat, data.lon,
      JSON.stringify(data.properties || {}),
      data.source || 'user', data.createdBy || '', now, now
    );
    return { ...data, id, type: 'pin', projectId, createdAt: now, updatedAt: now };
  }

  updatePin(projectId, id, changes) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM project_pins WHERE id = ? AND project_id = ?').get(id, projectId);
    if (!row) return null;

    const updates = {};
    if (changes.lat !== undefined) updates.lat = changes.lat;
    if (changes.lon !== undefined) updates.lon = changes.lon;
    if (changes.properties !== undefined) updates.properties = JSON.stringify(changes.properties);
    if (changes.layerId !== undefined) updates.layer_id = changes.layerId;

    if (Object.keys(updates).length === 0) return rowToPin(row);

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    db.prepare(
      `UPDATE project_pins SET ${setClauses}, updated_at = datetime('now') WHERE id = ? AND project_id = ?`
    ).run(...values, id, projectId);

    const updated = db.prepare('SELECT * FROM project_pins WHERE id = ?').get(id);
    return rowToPin(updated);
  }

  deletePin(projectId, id) {
    const db = getDb();
    const result = db.prepare('DELETE FROM project_pins WHERE id = ? AND project_id = ?').run(id, projectId);
    return result.changes > 0;
  }
}

// --- Row → Object converters ---

function rowToMarker(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: 'marker',
    layerId: row.layer_id,
    sidc: row.sidc,
    lat: row.lat,
    lon: row.lon,
    designation: row.designation,
    higherFormation: row.higher_formation,
    additionalInfo: row.additional_info,
    customLabel: row.custom_label,
    source: row.source,
    createdBy: row.created_by,
    properties: tryParseJson(row.properties, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToDrawing(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: 'drawing',
    layerId: row.layer_id,
    drawingType: row.drawing_type,
    geometry: tryParseJson(row.geometry, {}),
    properties: tryParseJson(row.properties, {}),
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToLayer(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    visible: !!row.visible,
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function rowToPin(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: 'pin',
    layerId: row.layer_id,
    pinType: row.pin_type,
    lat: row.lat,
    lon: row.lon,
    properties: tryParseJson(row.properties, {}),
    source: row.source,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function tryParseJson(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

// Singleton
export const projectStore = new ProjectStoreManager();
