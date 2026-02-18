import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import config from './config.js';
import apiRouter from './routes/api.js';
import { setupSocket } from './socket/index.js';
import { loadState } from './store/index.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Make io accessible to routes
app.set('io', io);

app.use('/api', apiRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Load persisted state
loadState();

// Setup Socket.IO
setupSocket(io);

server.listen(config.port, () => {
  console.log(`IntelMap backend listening on port ${config.port}`);
});
