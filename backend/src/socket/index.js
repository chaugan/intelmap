import { registerHandlers } from './handlers.js';

export function setupSocket(io) {
  io.on('connection', (socket) => {
    registerHandlers(socket, io);
  });
}
