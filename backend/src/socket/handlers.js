import { EVENTS } from './events.js';
import { markers, drawings, layers, getFullState, saveState } from '../store/index.js';

export function registerHandlers(socket, io) {
  // Send full state on request
  socket.on(EVENTS.CLIENT_REQUEST_STATE, () => {
    socket.emit(EVENTS.SERVER_STATE, getFullState());
  });

  // --- Markers ---
  socket.on(EVENTS.CLIENT_MARKER_ADD, (data) => {
    const marker = markers.add(data);
    io.emit(EVENTS.SERVER_MARKER_ADDED, marker);
    saveState();
  });

  socket.on(EVENTS.CLIENT_MARKER_UPDATE, ({ id, ...changes }) => {
    const updated = markers.update(id, changes);
    if (updated) {
      io.emit(EVENTS.SERVER_MARKER_UPDATED, updated);
      saveState();
    }
  });

  socket.on(EVENTS.CLIENT_MARKER_DELETE, ({ id }) => {
    if (markers.delete(id)) {
      io.emit(EVENTS.SERVER_MARKER_DELETED, { id });
      saveState();
    }
  });

  // --- Drawings ---
  socket.on(EVENTS.CLIENT_DRAWING_ADD, (data) => {
    const drawing = drawings.add(data);
    io.emit(EVENTS.SERVER_DRAWING_ADDED, drawing);
    saveState();
  });

  socket.on(EVENTS.CLIENT_DRAWING_UPDATE, ({ id, ...changes }) => {
    const updated = drawings.update(id, changes);
    if (updated) {
      io.emit(EVENTS.SERVER_DRAWING_UPDATED, updated);
      saveState();
    }
  });

  socket.on(EVENTS.CLIENT_DRAWING_DELETE, ({ id }) => {
    if (drawings.delete(id)) {
      io.emit(EVENTS.SERVER_DRAWING_DELETED, { id });
      saveState();
    }
  });

  socket.on(EVENTS.CLIENT_DRAWING_DELETE_BATCH, ({ ids }) => {
    let deleted = 0;
    for (const id of ids) {
      if (drawings.delete(id)) {
        io.emit(EVENTS.SERVER_DRAWING_DELETED, { id });
        deleted++;
      }
    }
    if (deleted > 0) saveState();
  });

  // --- Layers ---
  socket.on(EVENTS.CLIENT_LAYER_ADD, (data) => {
    const layer = layers.add(data);
    io.emit(EVENTS.SERVER_LAYER_ADDED, layer);
    saveState();
  });

  socket.on(EVENTS.CLIENT_LAYER_UPDATE, ({ id, ...changes }) => {
    const updated = layers.update(id, changes);
    if (updated) {
      io.emit(EVENTS.SERVER_LAYER_UPDATED, updated);
      saveState();
    }
  });

  socket.on(EVENTS.CLIENT_LAYER_DELETE, ({ id }) => {
    if (layers.delete(id)) {
      io.emit(EVENTS.SERVER_LAYER_DELETED, { id });
      saveState();
    }
  });
}
