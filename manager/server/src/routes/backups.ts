import { Router } from 'express';
import fs from 'node:fs';
import { store } from '../store.js';
import { backupService } from '../backupService.js';

export const backupsRouter = Router();

backupsRouter.get('/', (_req, res) => {
  res.json({
    backups: store.getBackups(),
    policy: store.getBackupPolicy(),
  });
});

backupsRouter.post('/create', async (req, res) => {
  try {
    const { serverId, note } = req.body as { serverId: string; note?: string };
    if (!serverId) {
      res.status(400).json({ error: 'serverId is required' });
      return;
    }
    const entry = await backupService.createBackup(serverId, 'manual', note);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

backupsRouter.post('/:id/restore', async (req, res) => {
  try {
    const { restartAfter } = req.body as { restartAfter?: boolean };
    await backupService.restoreBackup(req.params.id, restartAfter !== false);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

backupsRouter.get('/:id/download', (req, res) => {
  const backup = store.getBackups().find((b) => b.id === req.params.id);
  if (!backup) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  const filePath = backupService.getBackupFilePath(backup);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Backup file missing on disk' });
    return;
  }
  res.download(filePath, backup.filename);
});

backupsRouter.delete('/:id', (req, res) => {
  const deleted = backupService.deleteBackup(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }
  res.json({ ok: true });
});

backupsRouter.put('/policy', (req, res) => {
  try {
    const updated = backupService.updatePolicy(req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
