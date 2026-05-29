import './config/env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import { prisma } from './config/database';
import { redis } from './config/redis';
import { setupWebSocket } from './utils/websocket';
import { logger } from './utils/logger';

// Routes
import authRoutes from './routes/auth.routes';
import walletRoutes from './routes/wallet.routes';
import jobsRoutes from './routes/jobs.routes';
import uploadRoutes from './routes/upload.routes';
import dashboardRoutes from './routes/dashboard.routes';
import blueprintsRoutes from './routes/blueprints.routes';
import studioRoutes from './routes/studio.routes';
import paymentsRoutes from './routes/payments.routes'; // ← NEW

// Workers
import './queues/workers/agent.worker';
import './queues/workers/vimax.worker';

const app = express();
const httpServer = createServer(app);

// ── WebSocket ─────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer, path: '/ws/jobs' });
setupWebSocket(wss);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));

// IMPORTANT: Raw body needed for Razorpay webhook signature verification
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

app.use(rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
}));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: { database: 'ok', redis: 'ok' },
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/v1/auth',       authRoutes);
app.use('/api/v1/wallet',     walletRoutes);
app.use('/api/v1/jobs',       jobsRoutes);
app.use('/api/v1/upload',     uploadRoutes);
app.use('/api/v1/dashboard',  dashboardRoutes);
app.use('/api/v1/blueprints', blueprintsRoutes);
app.use('/api/v1/studio',     studioRoutes);
app.use('/api/v1/payments',   paymentsRoutes); // ← NEW

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10);
httpServer.listen(PORT, () => {
  logger.info(`🚀 Backend running on http://localhost:${PORT}`);
  logger.info(`🔌 WebSocket at ws://localhost:${PORT}/ws/jobs`);
  logger.info(`📋 Routes: auth|wallet|jobs|upload|dashboard|blueprints|studio|payments`);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
});
