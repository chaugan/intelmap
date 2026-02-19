import { useEffect } from 'react';
import { socket } from '../lib/socket.js';
import { useTacticalStore } from '../stores/useTacticalStore.js';
import { useAuthStore } from '../stores/useAuthStore.js';

export function useSocket() {
  useEffect(() => {
    const store = useTacticalStore.getState();

    const onConnect = () => {
      // Join all visible project rooms
      const { visibleProjectIds } = useTacticalStore.getState();
      if (visibleProjectIds && visibleProjectIds.length > 0) {
        for (const pid of visibleProjectIds) {
          socket.emit('client:project:join', { projectId: pid });
        }
      }
    };

    const onForceDisconnect = () => {
      socket.disconnect();
      useAuthStore.getState().logout();
    };

    // --- Project-scoped events ---
    const onProjectState = ({ projectId, markers, drawings, layers, pins }) => {
      useTacticalStore.getState().setProjectState(projectId, { markers, drawings, layers, pins });
    };

    const onMarkerAdded = (data) => {
      useTacticalStore.getState().addMarker(data.projectId, data);
    };
    const onMarkerUpdated = (data) => {
      useTacticalStore.getState().updateMarker(data.projectId, data);
    };
    const onMarkerDeleted = ({ projectId, id }) => {
      useTacticalStore.getState().deleteMarker(projectId, id);
    };

    const onDrawingAdded = (data) => {
      useTacticalStore.getState().addDrawing(data.projectId, data);
    };
    const onDrawingUpdated = (data) => {
      useTacticalStore.getState().updateDrawing(data.projectId, data);
    };
    const onDrawingDeleted = ({ projectId, id }) => {
      useTacticalStore.getState().deleteDrawing(projectId, id);
    };

    const onLayerAdded = (data) => {
      useTacticalStore.getState().addLayer(data.projectId, data);
    };
    const onLayerUpdated = (data) => {
      useTacticalStore.getState().updateLayer(data.projectId, data);
    };
    const onLayerDeleted = ({ projectId, id }) => {
      useTacticalStore.getState().deleteLayer(projectId, id);
    };

    const onPinAdded = (data) => {
      useTacticalStore.getState().addPin(data.projectId, data);
    };
    const onPinUpdated = (data) => {
      useTacticalStore.getState().updatePin(data.projectId, data);
    };
    const onPinDeleted = ({ projectId, id }) => {
      useTacticalStore.getState().deletePin(projectId, id);
    };

    socket.on('connect', onConnect);
    socket.on('server:force-disconnect', onForceDisconnect);
    socket.on('server:project:state', onProjectState);
    socket.on('server:marker:added', onMarkerAdded);
    socket.on('server:marker:updated', onMarkerUpdated);
    socket.on('server:marker:deleted', onMarkerDeleted);
    socket.on('server:drawing:added', onDrawingAdded);
    socket.on('server:drawing:updated', onDrawingUpdated);
    socket.on('server:drawing:deleted', onDrawingDeleted);
    socket.on('server:layer:added', onLayerAdded);
    socket.on('server:layer:updated', onLayerUpdated);
    socket.on('server:layer:deleted', onLayerDeleted);
    socket.on('server:pin:added', onPinAdded);
    socket.on('server:pin:updated', onPinUpdated);
    socket.on('server:pin:deleted', onPinDeleted);

    return () => {
      socket.off('connect', onConnect);
      socket.off('server:force-disconnect', onForceDisconnect);
      socket.off('server:project:state', onProjectState);
      socket.off('server:marker:added', onMarkerAdded);
      socket.off('server:marker:updated', onMarkerUpdated);
      socket.off('server:marker:deleted', onMarkerDeleted);
      socket.off('server:drawing:added', onDrawingAdded);
      socket.off('server:drawing:updated', onDrawingUpdated);
      socket.off('server:drawing:deleted', onDrawingDeleted);
      socket.off('server:layer:added', onLayerAdded);
      socket.off('server:layer:updated', onLayerUpdated);
      socket.off('server:layer:deleted', onLayerDeleted);
      socket.off('server:pin:added', onPinAdded);
      socket.off('server:pin:updated', onPinUpdated);
      socket.off('server:pin:deleted', onPinDeleted);
    };
  }, []);
}
