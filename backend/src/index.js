import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import config from './config.js';
import apiRouter from './routes/api.js';
import { setupSocket } from './socket/index.js';
import { loadState } from './store/index.js';
import { initDb } from './db/index.js';
import { cleanExpiredSessions } from './auth/sessions.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser(config.sessionSecret));

// Make io accessible to routes
app.set('io', io);

app.use('/api', apiRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Initialize database (creates tables, seeds admin)
initDb();

// Load persisted state
loadState();

// Setup Socket.IO
setupSocket(io);

// Clean expired sessions every hour
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

server.listen(config.port, () => {
  console.log(`IntelMap backend listening on port ${config.port}`);
});
