import { Router } from 'express';
import fs from 'node:fs';
import { store } from '../store.js';
import { dockerService } from '../dockerService.js';
import { worldService } from '../worldService.js';
import { getServerConfigDir } from '../config.js';
import type { ServerConfig, ServerWithStatus, WorldModifiers } from '../types.js';

export const serversRouter = Router();

const defaultModifiers: WorldModifiers = {
  preset: '',
  combat: '',
  deathPenalty: '',
  resources: '',
  raids: '',
  portals: '',
  noBuildCost: false,
  playerEvents: false,
  passiveMobs: false,
  noMap: false,
  fire: false,
  dungeonBuild: false,
};

function slugifyId(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'server'}-${suffix}`;
}

serversRouter.get('/', async (_req, res) => {
  try {
    const servers = store.getServers();
    const withStatus: ServerWithStatus[] = await Promise.all(
      servers.map(async (srv) => ({
        ...srv,
        runtime: await dockerService.getServerRuntimeStatus(srv.id),
      }))
    );
    res.json({
      dockerAvailable: dockerService.isAvailable(),
      nextAvailablePort: store.getNextAvailablePort(),
      servers: withStatus,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.post('/', async (req, res) => {
  try {
    const body = req.body as Partial<ServerConfig> & { startImmediately?: boolean };
    const name = (body.name || '').trim();
    const worldName = (body.worldName || '').trim();
    const password = (body.password || '').trim();

    if (!name) {
      res.status(400).json({ error: 'Server name is required' });
      return;
    }
    if (!worldName) {
      res.status(400).json({ error: 'World name is required' });
      return;
    }
    if (password.length < 5) {
      res.status(400).json({ error: 'Valheim requires server passwords to be at least 5 characters' });
      return;
    }

    const port = body.port ? Number(body.port) : store.getNextAvailablePort();
    // Ensure port doesn't collide with existing server
    const conflict = store
      .getServers()
      .find((s) => Math.abs(s.port - port) < 2);
    if (conflict) {
      res.status(409).json({
        error: `Port ${port} (uses ${port}-${port + 1}/udp) conflicts with server "${conflict.name}" on port ${conflict.port}`,
      });
      return;
    }

    const now = new Date().toISOString();
    const server: ServerConfig = {
      id: slugifyId(name),
      name,
      description: (body.description || '').trim(),
      worldName,
      password,
      port,
      isPublic: Boolean(body.isPublic ?? false),
      crossplay: Boolean(body.crossplay ?? false),
      saveInterval: Number(body.saveInterval) || 1800,
      backupsCount: Number(body.backupsCount) || 4,
      backupShort: Number(body.backupShort) || 7200,
      backupLong: Number(body.backupLong) || 43200,
      updateOnStart: body.updateOnStart !== false,
      autoStart: body.autoStart !== false,
      modifiers: { ...defaultModifiers, ...(body.modifiers ?? {}) },
      extraArgs: (body.extraArgs || '').trim(),
      createdAt: now,
      updatedAt: now,
    };

    fs.mkdirSync(getServerConfigDir(server.id), { recursive: true });
    store.addServer(server);

    if (dockerService.isAvailable()) {
      await dockerService.createOrRecreateContainer(server, Boolean(body.startImmediately));
    }

    const runtime = await dockerService.getServerRuntimeStatus(server.id);
    res.status(201).json({ ...server, runtime });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.put('/:id', async (req, res) => {
  try {
    const existing = store.getServer(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const body = req.body as Partial<ServerConfig> & { recreateContainer?: boolean };
    const password = (body.password ?? existing.password).trim();
    if (password.length < 5) {
      res.status(400).json({ error: 'Password must be at least 5 characters' });
      return;
    }

    const port = body.port ? Number(body.port) : existing.port;
    const conflict = store
      .getServers()
      .find((s) => s.id !== existing.id && Math.abs(s.port - port) < 2);
    if (conflict) {
      res.status(409).json({
        error: `Port ${port} conflicts with server "${conflict.name}" on port ${conflict.port}`,
      });
      return;
    }

    const updated: ServerConfig = {
      ...existing,
      name: (body.name ?? existing.name).trim(),
      description: (body.description ?? existing.description).trim(),
      worldName: (body.worldName ?? existing.worldName).trim(),
      password,
      port,
      isPublic: body.isPublic ?? existing.isPublic,
      crossplay: body.crossplay ?? existing.crossplay,
      saveInterval: Number(body.saveInterval ?? existing.saveInterval),
      backupsCount: Number(body.backupsCount ?? existing.backupsCount),
      backupShort: Number(body.backupShort ?? existing.backupShort ?? 7200),
      backupLong: Number(body.backupLong ?? existing.backupLong ?? 43200),
      updateOnStart: body.updateOnStart ?? existing.updateOnStart,
      autoStart: body.autoStart ?? existing.autoStart,
      modifiers: { ...existing.modifiers, ...(body.modifiers ?? {}) },
      extraArgs: (body.extraArgs ?? existing.extraArgs).trim(),
      updatedAt: new Date().toISOString(),
    };

    store.updateServer(existing.id, updated);

    if (dockerService.isAvailable() && body.recreateContainer !== false) {
      const status = await dockerService.getServerRuntimeStatus(existing.id);
      const wasRunning = status.state === 'running';
      await dockerService.createOrRecreateContainer(updated, wasRunning);
    }

    const runtime = await dockerService.getServerRuntimeStatus(existing.id);
    res.json({ ...updated, runtime });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.delete('/:id', async (req, res) => {
  try {
    const existing = store.getServer(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    await dockerService.removeContainer(existing.id);
    store.deleteServer(existing.id);

    if (req.query.deleteFiles === 'true') {
      const dir = getServerConfigDir(existing.id);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.post('/:id/start', async (req, res) => {
  try {
    const server = store.getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    await dockerService.startServer(server);
    store.addActivity('server', `Started server "${server.name}"`);
    store.save();
    const runtime = await dockerService.getServerRuntimeStatus(server.id);
    res.json({ ok: true, runtime });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.post('/:id/stop', async (req, res) => {
  try {
    const server = store.getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    await dockerService.stopServer(server.id);
    store.addActivity('server', `Stopped server "${server.name}" (graceful save)`);
    store.save();
    const runtime = await dockerService.getServerRuntimeStatus(server.id);
    res.json({ ok: true, runtime });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.post('/:id/restart', async (req, res) => {
  try {
    const server = store.getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    await dockerService.restartServer(server);
    store.addActivity('server', `Restarted server "${server.name}"`);
    store.save();
    const runtime = await dockerService.getServerRuntimeStatus(server.id);
    res.json({ ok: true, runtime });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.get('/:id/logs', async (req, res) => {
  try {
    const server = store.getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    const tail = Math.min(2000, Math.max(10, Number(req.query.tail) || 250));
    const logs = await dockerService.getLogsTail(server.id, tail);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.get('/:id/lists', (req, res) => {
  try {
    const server = store.getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    res.json(worldService.getPlayerLists(server.id));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

serversRouter.put('/:id/lists', (req, res) => {
  try {
    const server = store.getServer(req.params.id);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    const updated = worldService.savePlayerLists(server.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
