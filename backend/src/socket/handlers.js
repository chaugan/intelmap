import { EVENTS } from './events.js';
import { projectStore } from '../store/project-store.js';
import { getProjectRole, canMutateProject } from '../auth/project-access.js';

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
  });

  socket.on(EVENTS.CLIENT_MARKER_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updateMarker(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_UPDATED, updated);
    }
  });

  socket.on(EVENTS.CLIENT_MARKER_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deleteMarker(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_MARKER_DELETED, { projectId, id });
    }
  });

  // --- Drawings ---
  socket.on(EVENTS.CLIENT_DRAWING_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const drawing = projectStore.addDrawing(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
  });

  socket.on(EVENTS.CLIENT_DRAWING_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updateDrawing(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_UPDATED, updated);
    }
  });

  socket.on(EVENTS.CLIENT_DRAWING_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deleteDrawing(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_DRAWING_DELETED, { projectId, id });
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
  });

  // --- Layers ---
  socket.on(EVENTS.CLIENT_LAYER_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const layer = projectStore.addLayer(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_ADDED, layer);
  });

  socket.on(EVENTS.CLIENT_LAYER_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updateLayer(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_UPDATED, updated);
    }
  });

  socket.on(EVENTS.CLIENT_LAYER_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deleteLayer(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_LAYER_DELETED, { projectId, id });
    }
  });

  // --- Pins ---
  socket.on(EVENTS.CLIENT_PIN_ADD, (data) => {
    const { projectId } = data;
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const pin = projectStore.addPin(projectId, data);
    io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_ADDED, pin);
  });

  socket.on(EVENTS.CLIENT_PIN_UPDATE, ({ projectId, id, ...changes }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    const updated = projectStore.updatePin(projectId, id, changes);
    if (updated) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_UPDATED, updated);
    }
  });

  socket.on(EVENTS.CLIENT_PIN_DELETE, ({ projectId, id }) => {
    if (!projectId || !canMutateProject(userId, projectId)) return;
    if (projectStore.deletePin(projectId, id)) {
      io.to(`project:${projectId}`).emit(EVENTS.SERVER_PIN_DELETED, { projectId, id });
    }
  });
}
