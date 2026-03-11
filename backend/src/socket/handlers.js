import { EVENTS } from './events.js';
import { projectStore } from '../store/project-store.js';
import { getProjectRole, canMutateProject } from '../auth/project-access.js';
import { addViewshed, deleteViewshed, deleteAllViewsheds } from '../store/viewshed-store.js';
import { addRFCoverage, deleteRFCoverage, deleteAllRFCoverages } from '../store/rfcoverage-store.js';
import { logAudit } from '../lib/audit-logger.js';

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
    logAudit(io, projectId, userId, socket.user.username, 'add', 'marker', marker.id,
      `Added marker ${marker.sidc || ''}`.trim(), { sidc: marker.sidc });
  });

  socket.on(EVENTS.CLIENT_MARKER_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updateMarker(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_UPDATED, updated);
      logAudit(io, projectId, userId, socket.user.username, 'update', 'marker', id,
        `Updated marker ${id.slice(0, 8)}`);
    }
  });

  socket.on(EVENTS.CLIENT_MARKER_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deleteMarker(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'marker', id, 'Deleted marker');
    }
  });

  // --- Drawings ---
  socket.on(EVENTS.CLIENT_DRAWING_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const drawing = projectStore.addDrawing(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'drawing', drawing.id,
      `Added ${drawing.drawing_type || 'drawing'}`, { drawingType: drawing.drawing_type });
  });

  socket.on(EVENTS.CLIENT_DRAWING_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updateDrawing(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_UPDATED, updated);
      logAudit(io, projectId, userId, socket.user.username, 'update', 'drawing', id, 'Updated drawing');
    }
  });

  socket.on(EVENTS.CLIENT_DRAWING_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deleteDrawing(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'drawing', id, 'Deleted drawing');
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
    const updated = projectStore.updateLayer(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_UPDATED, updated);
      logAudit(io, projectId, userId, socket.user.username, 'update', 'layer', id,
        `Updated layer '${updated.name || ''}'`, { name: updated.name });
    }
  });

  socket.on(EVENTS.CLIENT_LAYER_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deleteLayer(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'layer', id, 'Deleted layer');
    }
  });

  // --- Pins ---
  socket.on(EVENTS.CLIENT_PIN_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const pin = projectStore.addPin(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_ADDED, pin);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'pin', pin.id, 'Added pin');
  });

  socket.on(EVENTS.CLIENT_PIN_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updatePin(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_UPDATED, updated);
      logAudit(io, projectId, userId, socket.user.username, 'update', 'pin', id, 'Updated pin');
    }
  });

  socket.on(EVENTS.CLIENT_PIN_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deletePin(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'pin', id, 'Deleted pin');
    }
  });

  // --- Viewsheds ---
  socket.on(EVENTS.CLIENT_VIEWSHED_SAVE, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const viewshed = addViewshed(projectId, { ...data, createdBy: userId });
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_VIEWSHED_ADDED, viewshed);
    logAudit(io, projectId, userId, socket.user.username, 'add', 'viewshed', viewshed.id, 'Added viewshed');
  });

  socket.on(EVENTS.CLIENT_VIEWSHED_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (deleteViewshed(id, projectId)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_VIEWSHED_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'viewshed', id, 'Deleted viewshed');
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
    logAudit(io, projectId, userId, socket.user.username, 'add', 'rfcoverage', coverage.id, 'Added RF coverage');
  });

  socket.on(EVENTS.CLIENT_RFCOVERAGE_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (deleteRFCoverage(id, projectId)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_RFCOVERAGE_DELETED, { projectId, id });
      logAudit(io, projectId, userId, socket.user.username, 'delete', 'rfcoverage', id, 'Deleted RF coverage');
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
