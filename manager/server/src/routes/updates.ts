import { Router } from 'express';
import { store } from '../store.js';
import { updateService } from '../updateService.js';

export const updatesRouter = Router();

updatesRouter.get('/', (_req, res) => {
  updateService.readInstalledBuildId();
  res.json(store.getUpdatePolicy());
});

updatesRouter.post('/check', async (_req, res) => {
  try {
    const policy = await updateService.checkForUpdates();
    res.json(policy);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

updatesRouter.post('/run', (_req, res) => {
  if (store.getUpdatePolicy().isUpdating) {
    res.status(409).json({ error: 'An update is already running' });
    return;
  }
  // Run asynchronously so UI can poll progress logs
  updateService.performUpdate().catch((err) => {
    console.error('[UpdatesRoute] Update run failed:', err);
  });
  res.json({ ok: true, started: true });
});

updatesRouter.put('/policy', (req, res) => {
  try {
    const updated = updateService.updatePolicy(req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
