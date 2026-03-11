import { EVENTS } from './events.js';
import { projectStore } from '../store/project-store.js';
import { getProjectRole, canMutateProject } from '../auth/project-access.js';
import { addViewshed, deleteViewshed, deleteAllViewsheds } from '../store/viewshed-store.js';
import { addRFCoverage, deleteRFCoverage, deleteAllRFCoverages } from '../store/rfcoverage-store.js';
import { logAudit } from '../lib/audit-logger.js';
import { getDb } from '../db/index.js';

// --- Audit helpers ---

function markerName(row) {
  if (!row) return '';
  // row can be a DB row (snake_case) or a store object (camelCase)
  return row.designation || row.custom_label || row.customLabel || row.sidc || '';
}

function drawingLabel(row) {
  if (!row) return '';
  try {
    const props = typeof row.properties === 'string' ? JSON.parse(row.properties) : (row.properties || {});
    return props.label || '';
  } catch { return ''; }
}

function drawingTypeName(row) {
  return row.drawing_type || row.drawingType || 'drawing';
}

function drawingDisplayName(row) {
  const label = drawingLabel(row);
  const type = drawingTypeName(row);
  return label ? `${type} '${label}'` : type;
}

function drawingCoords(row) {
  try {
    const g = typeof row.geometry === 'string' ? JSON.parse(row.geometry) : (row.geometry || {});
    if (g.center) return { lat: g.center[1], lon: g.center[0] };
    if (g.coordinates) {
      const c = g.coordinates;
      if (Array.isArray(c[0])) {
        const mid = c[Math.floor(c.length / 2)];
        return { lat: mid[1], lon: mid[0] };
      }
      if (typeof c[0] === 'number') return { lat: c[1], lon: c[0] };
    }
  } catch {}
  return null;
}

function markerChanges(oldRow, changes) {
  const diff = {};
  if ((changes.lat !== undefined || changes.lon !== undefined) &&
      (changes.lat !== oldRow.lat || changes.lon !== oldRow.lon)) {
    diff.position = {
      from: `${oldRow.lat.toFixed(5)}, ${oldRow.lon.toFixed(5)}`,
      to: `${(changes.lat ?? oldRow.lat).toFixed(5)}, ${(changes.lon ?? oldRow.lon).toFixed(5)}`
    };
  }
  if (changes.designation !== undefined && changes.designation !== oldRow.designation) {
    diff.designation = { from: oldRow.designation || '', to: changes.designation || '' };
  }
  if (changes.customLabel !== undefined && changes.customLabel !== oldRow.custom_label) {
    diff.customLabel = { from: oldRow.custom_label || '', to: changes.customLabel || '' };
  }
  if (changes.sidc !== undefined && changes.sidc !== oldRow.sidc) {
    diff.sidc = { from: oldRow.sidc || '', to: changes.sidc || '' };
  }
  if (changes.higherFormation !== undefined && changes.higherFormation !== oldRow.higher_formation) {
    diff.higherFormation = { from: oldRow.higher_formation || '', to: changes.higherFormation || '' };
  }
  if (changes.additionalInfo !== undefined && changes.additionalInfo !== oldRow.additional_info) {
    diff.additionalInfo = { from: oldRow.additional_info || '', to: changes.additionalInfo || '' };
  }
  return diff;
}

function drawingChanges(oldRow, changes) {
  const diff = {};
  if (changes.properties !== undefined) {
    try {
      const oldProps = typeof oldRow.properties === 'string' ? JSON.parse(oldRow.properties) : (oldRow.properties || {});
      const newProps = changes.properties || {};
      if (newProps.label !== undefined && newProps.label !== oldProps.label) {
        diff.label = { from: oldProps.label || '', to: newProps.label || '' };
      }
      if (newProps.color !== undefined && newProps.color !== oldProps.color) {
        diff.color = { from: oldProps.color || '', to: newProps.color || '' };
      }
    } catch {}
  }
  if (changes.geometry !== undefined) {
    diff.geometry = true;
  }
  return diff;
}

export function registerHandlers(socket, io) {
  const userId = socket.user.id;

  // --- Join / Leave project rooms ---
  socket.on(EVENTS.CLIENT_PROJECT_JOIN, ({ projectId }) => {
    if (!projectId) return;
    const role = getProjectRole(userId, projectId);
    if (!role) return; // No access
    socket.join(`project:${projectId}`);
    const state = projectStore.getProjectState(projectId);
    socket.emit(EVENTS.SERVER_PROJECT_STATE, { projectId, ...state });
  });

  socket.on(EVENTS.CLIENT_PROJECT_LEAVE, ({ projectId }) => {
    if (!projectId) return;
    socket.leave(`project:${projectId}`);
  });

  // --- Markers ---
  socket.on(EVENTS.CLIENT_MARKER_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const marker = projectStore.addMarker(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_ADDED, marker);
    const name = markerName(marker);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'marker', marker.id,
      `Added marker '${name}'`, { sidc: marker.sidc, designation: marker.designation, customLabel: marker.customLabel, lat: marker.lat, lon: marker.lon });
  });

  socket.on(EVENTS.CLIENT_MARKER_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_markers WHERE id = ? AND project_id = ?').get(id, projectId);
    const updated = projectStore.updateMarker(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_UPDATED, updated);
      const name = markerName(updated);
      const diff = oldRow ? markerChanges(oldRow, changes) : {};
      logAudit(io, projectId, userId, socket.user.username, 'update', 'marker', id,
        `Updated marker '${name}'`, { lat: updated.lat, lon: updated.lon, sidc: updated.sidc, changes: diff });
    }
  });

  socket.on(EVENTS.CLIENT_MARKER_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_markers WHERE id = ? AND project_id = ?').get(id, projectId);
    if (projectStore.deleteMarker(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_DELETED, { projectId, id });
      const name = markerName(oldRow);
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'marker', id,
        `Deleted marker '${name}'`, { sidc: oldRow?.sidc, lat: oldRow?.lat, lon: oldRow?.lon });
    }
  });

  // --- Drawings ---
  socket.on(EVENTS.CLIENT_DRAWING_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const drawing = projectStore.addDrawing(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
    const coords = drawingCoords(drawing);
    const label = drawingLabel(drawing);
    const type = drawingTypeName(drawing);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'drawing', drawing.id,
      `Added ${label ? `${type} '${label}'` : type}`,
      { drawingType: type, label, lat: coords?.lat, lon: coords?.lon });
  });

  socket.on(EVENTS.CLIENT_DRAWING_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_drawings WHERE id = ? AND project_id = ?').get(id, projectId);
    const updated = projectStore.updateDrawing(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_UPDATED, updated);
      const displayName = drawingDisplayName(updated);
      const coords = drawingCoords(updated);
      const diff = oldRow ? drawingChanges(oldRow, changes) : {};
      logAudit(io, projectId, userId, socket.user.username, 'update', 'drawing', id,
        `Updated ${displayName}`,
        { drawingType: drawingTypeName(updated), lat: coords?.lat, lon: coords?.lon, changes: diff });
    }
  });

  socket.on(EVENTS.CLIENT_DRAWING_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_drawings WHERE id = ? AND project_id = ?').get(id, projectId);
    if (projectStore.deleteDrawing(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_DELETED, { projectId, id });
      const displayName = oldRow ? drawingDisplayName(oldRow) : 'drawing';
      const coords = oldRow ? drawingCoords(oldRow) : null;
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'drawing', id,
        `Deleted ${displayName}`, { drawingType: oldRow?.drawing_type, lat: coords?.lat, lon: coords?.lon });
    }
  });

  socket.on(EVENTS.CLIENT_DRAWING_DELETE_BATCH, ({ projectId, ids }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    let deleted = 0;
    for (const id of ids) {
      if (projectStore.deleteDrawing(projectId, id)) {
        io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_DELETED, { projectId, id });
        deleted++;
      }
    }
    if (deleted > 0) {
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'drawing', null,
        `Deleted ${deleted} drawings`, { count: deleted });
    }
  });

  // --- Layers ---
  socket.on(EVENTS.CLIENT_LAYER_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const layer = projectStore.addLayer(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_ADDED, layer);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'layer', layer.id,
      `Added layer '${layer.name || ''}'`, { name: layer.name });
  });

  socket.on(EVENTS.CLIENT_LAYER_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_layers WHERE id = ? AND project_id = ?').get(id, projectId);
    const updated = projectStore.updateLayer(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_UPDATED, updated);
      const diff = {};
      if (oldRow && changes.name !== undefined && changes.name !== oldRow.name) {
        diff.name = { from: oldRow.name, to: changes.name };
      }
      if (oldRow && changes.visible !== undefined && !!changes.visible !== !!oldRow.visible) {
        diff.visible = { from: !!oldRow.visible, to: !!changes.visible };
      }
      logAudit(io, projectId, userId, socket.user.username, 'update', 'layer', id,
        `Updated layer '${updated.name || ''}'`, { name: updated.name, changes: diff });
    }
  });

  socket.on(EVENTS.CLIENT_LAYER_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_layers WHERE id = ? AND project_id = ?').get(id, projectId);
    if (projectStore.deleteLayer(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'layer', id,
        `Deleted layer '${oldRow?.name || ''}'`, { name: oldRow?.name });
    }
  });

  // --- Pins ---
  socket.on(EVENTS.CLIENT_PIN_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const pin = projectStore.addPin(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_ADDED, pin);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'pin', pin.id,
      `Added pin (${pin.pinType || data.pinType || 'context'})`,
      { pinType: pin.pinType || data.pinType, lat: pin.lat || data.lat, lon: pin.lon || data.lon });
  });

  socket.on(EVENTS.CLIENT_PIN_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_pins WHERE id = ? AND project_id = ?').get(id, projectId);
    const updated = projectStore.updatePin(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_UPDATED, updated);
      const diff = {};
      if (oldRow && (changes.lat !== undefined || changes.lon !== undefined) &&
          (changes.lat !== oldRow.lat || changes.lon !== oldRow.lon)) {
        diff.position = {
          from: `${oldRow.lat.toFixed(5)}, ${oldRow.lon.toFixed(5)}`,
          to: `${(changes.lat ?? oldRow.lat).toFixed(5)}, ${(changes.lon ?? oldRow.lon).toFixed(5)}`
        };
      }
      logAudit(io, projectId, userId, socket.user.username, 'update', 'pin', id,
        `Updated pin (${updated.pinType || 'context'})`,
        { pinType: updated.pinType, lat: updated.lat, lon: updated.lon, changes: diff });
    }
  });

  socket.on(EVENTS.CLIENT_PIN_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_pins WHERE id = ? AND project_id = ?').get(id, projectId);
    if (projectStore.deletePin(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'pin', id,
        `Deleted pin (${oldRow?.pin_type || 'context'})`,
        { pinType: oldRow?.pin_type, lat: oldRow?.lat, lon: oldRow?.lon });
    }
  });

  // --- Viewsheds ---
  socket.on(EVENTS.CLIENT_VIEWSHED_SAVE, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const viewshed = addViewshed(projectId, { ...data, createdBy: userId });
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_VIEWSHED_ADDED, viewshed);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'viewshed', viewshed.id,
      'Added viewshed', { lat: data.latitude, lon: data.longitude });
  });

  socket.on(EVENTS.CLIENT_VIEWSHED_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_viewsheds WHERE id = ? AND project_id = ?').get(id, projectId);
    if (deleteViewshed(id, projectId)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_VIEWSHED_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'viewshed', id,
        'Deleted viewshed', { lat: oldRow?.latitude, lon: oldRow?.longitude });
    }
  });

  socket.on(EVENTS.CLIENT_VIEWSHED_DELETE_ALL, ({ projectId }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const count = deleteAllViewsheds(projectId);
    if (count > 0) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_VIEWSHED_ALL_DELETED, { projectId });
      logAudit(io, projectId, userId, socket.user.username, 'delete_all', 'viewshed', null, 'Deleted all viewsheds');
    }
  });

  // --- RF Coverages ---
  socket.on(EVENTS.CLIENT_RFCOVERAGE_SAVE, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const coverage = addRFCoverage(projectId, { ...data, createdBy: userId });
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_RFCOVERAGE_ADDED, coverage);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'rfcoverage', coverage.id,
      'Added RF coverage', { lat: data.latitude, lon: data.longitude });
  });

  socket.on(EVENTS.CLIENT_RFCOVERAGE_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const db = getDb();
    const oldRow = db.prepare('SELECT * FROM project_rf_coverages WHERE id = ? AND project_id = ?').get(id, projectId);
    if (deleteRFCoverage(id, projectId)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_RFCOVERAGE_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'rfcoverage', id,
        'Deleted RF coverage', { lat: oldRow?.latitude, lon: oldRow?.longitude });
    }
  });

  socket.on(EVENTS.CLIENT_RFCOVERAGE_DELETE_ALL, ({ projectId }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const count = deleteAllRFCoverages(projectId);
    if (count > 0) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_RFCOVERAGE_ALL_DELETED, { projectId });
      logAudit(io, projectId, userId, socket.user.username, 'delete_all', 'rfcoverage', null, 'Deleted all RF coverages');
    }
  });
}
