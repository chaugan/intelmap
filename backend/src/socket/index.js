import cookie from 'cookie';
import { validateSession } from '../auth/sessions.js';
import { registerHandlers } from './handlers.js';

// userId → Set<socket>
const connectedUsers = new Map();

export function setupSocket(io) {
  // Authentication middleware
  io.use((socket, next) => {
    const raw = socket.handshake.headers.cookie || '';
    const cookies = cookie.parse(raw);
    const user = validateSession(cookies.session);
    if (!user || user.locked) {
      return next(new Error('Authentication required'));
    }
    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;

    // Track connection
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId).add(socket);

    socket.on('disconnect', () => {
      const sockets = connectedUsers.get(userId);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) connectedUsers.delete(userId);
      }
    });

    registerHandlers(socket, io);
  });
}

/**
 * Force-disconnect all sockets for a user.
 * Used by admin actions (delete user, lock, reset password).
 */
export function disconnectUser(userId) {
  const sockets = connectedUsers.get(userId);
  if (!sockets) return;
  for (const socket of sockets) {
    socket.emit('server:force-disconnect');
    socket.disconnect(true);
  }
  connectedUsers.delete(userId);
}
