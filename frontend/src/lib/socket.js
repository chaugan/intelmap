import { io } from 'socket.io-client';

const URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

export const socket = io(URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity,
});
