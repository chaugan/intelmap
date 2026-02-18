export const EVENTS = {
  // Client → Server
  CLIENT_REQUEST_STATE: 'client:request-state',
  CLIENT_MARKER_ADD: 'client:marker:add',
  CLIENT_MARKER_UPDATE: 'client:marker:update',
  CLIENT_MARKER_DELETE: 'client:marker:delete',
  CLIENT_DRAWING_ADD: 'client:drawing:add',
  CLIENT_DRAWING_UPDATE: 'client:drawing:update',
  CLIENT_DRAWING_DELETE: 'client:drawing:delete',
  CLIENT_DRAWING_DELETE_BATCH: 'client:drawing:delete-batch',
  CLIENT_LAYER_ADD: 'client:layer:add',
  CLIENT_LAYER_UPDATE: 'client:layer:update',
  CLIENT_LAYER_DELETE: 'client:layer:delete',

  // Server → Client
  SERVER_STATE: 'server:state',
  SERVER_MARKER_ADDED: 'server:marker:added',
  SERVER_MARKER_UPDATED: 'server:marker:updated',
  SERVER_MARKER_DELETED: 'server:marker:deleted',
  SERVER_DRAWING_ADDED: 'server:drawing:added',
  SERVER_DRAWING_UPDATED: 'server:drawing:updated',
  SERVER_DRAWING_DELETED: 'server:drawing:deleted',
  SERVER_LAYER_ADDED: 'server:layer:added',
  SERVER_LAYER_UPDATED: 'server:layer:updated',
  SERVER_LAYER_DELETED: 'server:layer:deleted',
};
