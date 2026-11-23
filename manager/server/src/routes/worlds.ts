import { Router } from 'express';
import multer from 'multer';
import { worldService } from '../worldService.js';
import { store } from '../store.js';
import { dockerService } from '../dockerService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max per upload
});

export const worldsRouter = Router();

worldsRouter.get('/', (_req, res) => {
  try {
    res.json({ worlds: worldService.listAllWorlds() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

worldsRouter.post('/upload', upload.array('files', 20), (req, res) => {
  try {
    const location = String(req.body.location || 'vault');
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No .db, .fwl, or .zip files provided' });
      return;
    }
    const saved = worldService.handleUploadedFiles(location, files);
    res.json({ ok: true, worlds: saved });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

worldsRouter.post('/clone', (req, res) => {
  try {
    const { sourceLocation, worldName, targetLocation, newWorldName } = req.body as {
      sourceLocation: string;
      worldName: string;
      targetLocation: string;
      newWorldName?: string;
    };
    worldService.cloneWorld(sourceLocation, worldName, targetLocation, newWorldName);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Quick-swap: sets a server's active worldName to the chosen world and recreates/restarts it.
 */
worldsRouter.post('/activate', async (req, res) => {
  try {
    const { serverId, worldName, sourceLocation } = req.body as {
      serverId: string;
      worldName: string;
      sourceLocation?: string;
    };
    const server = store.getServer(serverId);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    // If the world lives in vault or another server, copy it into target server first
    if (sourceLocation && sourceLocation !== serverId) {
      worldService.cloneWorld(sourceLocation, worldName, serverId, worldName);
    }

    const updated = { ...server, worldName, updatedAt: new Date().toISOString() };
    store.updateServer(serverId, updated);

    if (dockerService.isAvailable()) {
      const status = await dockerService.getServerRuntimeStatus(serverId);
      const wasRunning = status.state === 'running';
      await dockerService.createOrRecreateContainer(updated, wasRunning);
    }

    store.addActivity('world', `Switched "${server.name}" active world to "${worldName}"`);
    store.save();
    res.json({ ok: true, server: updated });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

worldsRouter.get('/download/:location/:worldName', (req, res) => {
  try {
    worldService.streamWorldZip(req.params.location, req.params.worldName, res);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

worldsRouter.delete('/:location/:worldName', (req, res) => {
  try {
    worldService.deleteWorld(req.params.location, req.params.worldName);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
