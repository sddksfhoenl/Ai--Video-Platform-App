import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// Map: jobId → Set of connected WebSocket clients
const jobConnections = new Map<string, Set<WebSocket>>();

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // Extract jobId from URL: /ws/jobs/:jobId?token=xxx
    const url = new URL(req.url || '', `http://localhost`);
    const jobId = url.pathname.split('/').pop();
    const token = url.searchParams.get('token');

    if (!jobId || !token) {
      ws.close(1008, 'Missing jobId or token');
      return;
    }

    // Verify token
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      ws.close(1008, 'Invalid token');
      return;
    }

    // Register connection
    if (!jobConnections.has(jobId)) {
      jobConnections.set(jobId, new Set());
    }
    jobConnections.get(jobId)!.add(ws);
    logger.info(`WS client connected`, { jobId, userId: user.id });

    // Heartbeat ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    ws.on('close', () => {
      clearInterval(pingInterval);
      jobConnections.get(jobId)?.delete(ws);
      if (jobConnections.get(jobId)?.size === 0) {
        jobConnections.delete(jobId);
      }
      logger.info(`WS client disconnected`, { jobId });
    });

    ws.on('error', (err) => {
      logger.error(`WS error`, { jobId, error: err.message });
    });

    // Send initial connected message
    ws.send(JSON.stringify({ type: 'connected', data: { jobId } }));
  });
}

// Called by workers to broadcast progress
export function broadcastJobUpdate(jobId: string, message: object) {
  const clients = jobConnections.get(jobId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}
