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

updatesRouter.post('/run', (req, res) => {
  const current = store.getUpdatePolicy();
  if (current.isUpdating || current.pendingState !== 'idle') {
    res.status(409).json({ error: 'An update or countdown is already running' });
    return;
  }
  const forceImmediate = Boolean((req.body as { forceImmediate?: boolean })?.forceImmediate);
  updateService.scheduleOrRunUpdate(forceImmediate).catch((err) => {
    console.error('[UpdatesRoute] Update run failed:', err);
  });
  res.json({ ok: true, started: true });
});

updatesRouter.post('/cancel', (_req, res) => {
  updateService.cancelPendingUpdate();
  res.json({ ok: true, policy: store.getUpdatePolicy() });
});

updatesRouter.post('/test-broadcast', async (req, res) => {
  try {
    const msg =
      (req.body as { message?: string })?.message ||
      'Test announcement from POK-Valheim Manager!';
    const result = await updateService.broadcastNotice('POK-Valheim Test Notice', msg, 0x38bdf8);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

updatesRouter.put('/policy', (req, res) => {
  try {
    const updated = updateService.updatePolicy(req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
