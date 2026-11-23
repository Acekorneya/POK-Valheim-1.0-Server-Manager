import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { requireAuth, verifyToken } from './auth.js';
import { store } from './store.js';
import { dockerService } from './dockerService.js';
import { backupService } from './backupService.js';
import { updateService } from './updateService.js';
import { authRouter } from './routes/auth.js';
import { serversRouter } from './routes/servers.js';
import { worldsRouter } from './routes/worlds.js';
import { backupsRouter } from './routes/backups.js';
import { updatesRouter } from './routes/updates.js';
import { modsRouter } from './routes/mods.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  store.init();
  await dockerService.init();
  backupService.init();
  updateService.init();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Public auth endpoints + health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      name: 'POK-Valheim Manager',
      dockerAvailable: dockerService.isAvailable(),
    });
  });
  app.use('/api/auth', authRouter);

  // Protected API routes
  app.use('/api/servers', requireAuth, serversRouter);
  app.use('/api/worlds', requireAuth, worldsRouter);
  app.use('/api/backups', requireAuth, backupsRouter);
  app.use('/api/updates', requireAuth, updatesRouter);
  app.use('/api/mods', requireAuth, modsRouter);

  app.get('/api/activity', requireAuth, (_req, res) => {
    res.json({ activity: store.getState().activity });
  });

  // Serve built frontend static files in production
  const publicDir = path.resolve(__dirname, '../../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // WebSocket server for live container console streaming: ws://<host>/ws/logs/:serverId?token=...
  const wss = new WebSocketServer({ server, path: '/ws/logs' });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const serverId = url.searchParams.get('serverId');
    const token = url.searchParams.get('token') || '';

    if (config.auth.enabled && !verifyToken(token)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (!serverId || !store.getServer(serverId)) {
      ws.close(4004, 'Server not found');
      return;
    }

    let stopStream = () => {};
    try {
      stopStream = await dockerService.streamLogs(
        serverId,
        (line) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'log', line }));
          }
        },
        () => {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'end' }));
          }
        }
      );
    } catch (err) {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    }

    ws.on('close', () => {
      stopStream();
    });
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[POK-Valheim] Manager running on http://0.0.0.0:${config.port}`);
    console.log(`[POK-Valheim] Data directory: ${config.dataDir}`);
    console.log(`[POK-Valheim] Docker available: ${dockerService.isAvailable()}`);
  });
}

bootstrap().catch((err) => {
  console.error('[POK-Valheim] Fatal startup error:', err);
  process.exit(1);
});
