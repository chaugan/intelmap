import { useEffect } from 'react';
import { socket } from '../lib/socket.js';
import { useTacticalStore } from '../stores/useTacticalStore.js';

export function useSocket() {
  const {
    setState, addMarker, updateMarker, deleteMarker,
    addDrawing, updateDrawing, deleteDrawing,
    addLayer, updateLayer, deleteLayer,
  } = useTacticalStore();

  useEffect(() => {
    socket.on('connect', () => {
      socket.emit('client:request-state');
    });

    socket.on('server:state', setState);
    socket.on('server:marker:added', addMarker);
    socket.on('server:marker:updated', updateMarker);
    socket.on('server:marker:deleted', ({ id }) => deleteMarker(id));
    socket.on('server:drawing:added', addDrawing);
    socket.on('server:drawing:updated', updateDrawing);
    socket.on('server:drawing:deleted', ({ id }) => deleteDrawing(id));
    socket.on('server:layer:added', addLayer);
    socket.on('server:layer:updated', updateLayer);
    socket.on('server:layer:deleted', ({ id }) => deleteLayer(id));

    return () => {
      socket.off('connect');
      socket.off('server:state');
      socket.off('server:marker:added');
      socket.off('server:marker:updated');
      socket.off('server:marker:deleted');
      socket.off('server:drawing:added');
      socket.off('server:drawing:updated');
      socket.off('server:drawing:deleted');
      socket.off('server:layer:added');
      socket.off('server:layer:updated');
      socket.off('server:layer:deleted');
    };
  }, []);
}
