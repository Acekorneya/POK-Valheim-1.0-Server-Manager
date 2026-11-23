import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cron, { type ScheduledTask } from 'node-cron';
import * as tar from 'tar';
import { getBackupsDir, getServerConfigDir } from './config.js';
import { store } from './store.js';
import { dockerService } from './dockerService.js';
import type { BackupEntry, BackupPolicy } from './types.js';

class BackupService {
  private cronTask: ScheduledTask | null = null;

  init(): void {
    this.reschedule();
  }

  reschedule(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    const policy = store.getBackupPolicy();
    if (!policy.enabled) return;

    if (!cron.validate(policy.cronExpression)) {
      console.warn('[BackupService] Invalid cron expression:', policy.cronExpression);
      return;
    }

    this.cronTask = cron.schedule(policy.cronExpression, async () => {
      console.log('[BackupService] Running scheduled backups...');
      for (const server of store.getServers()) {
        try {
          await this.createBackup(server.id, 'scheduled', 'Automated scheduled backup');
        } catch (err) {
          console.error(`[BackupService] Scheduled backup failed for ${server.name}:`, err);
        }
      }
    });
  }

  updatePolicy(patch: Partial<BackupPolicy>): BackupPolicy {
    if (patch.cronExpression && !cron.validate(patch.cronExpression)) {
      throw new Error(`Invalid cron expression: ${patch.cronExpression}`);
    }
    const updated = store.updateBackupPolicy(patch);
    this.reschedule();
    return updated;
  }

  async createBackup(
    serverId: string,
    trigger: BackupEntry['trigger'] = 'manual',
    note?: string
  ): Promise<BackupEntry> {
    const server = store.getServer(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const configDir = getServerConfigDir(serverId);
    fs.mkdirSync(configDir, { recursive: true });

    const serverBackupDir = path.join(getBackupsDir(), serverId);
    fs.mkdirSync(serverBackupDir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeWorld = server.worldName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${serverId}_${safeWorld}_${ts}.tar.gz`;
    const archivePath = path.join(serverBackupDir, filename);

    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: configDir,
      },
      ['.']
    );

    const stat = fs.statSync(archivePath);
    const entry: BackupEntry = {
      id: crypto.randomUUID(),
      serverId: server.id,
      serverName: server.name,
      worldName: server.worldName,
      filename,
      sizeBytes: stat.size,
      createdAt: new Date().toISOString(),
      trigger,
      note,
    };

    store.addBackup(entry);
    this.pruneOldBackups(serverId);
    return entry;
  }

  private pruneOldBackups(serverId: string): void {
    const retention = store.getBackupPolicy().retentionCount;
    if (retention <= 0) return;

    const serverBackups = store
      .getBackups()
      .filter((b) => b.serverId === serverId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (serverBackups.length <= retention) return;

    const toDelete = serverBackups.slice(retention);
    for (const old of toDelete) {
      this.deleteBackup(old.id);
    }
  }

  getBackupFilePath(backup: BackupEntry): string {
    return path.join(getBackupsDir(), backup.serverId, backup.filename);
  }

  deleteBackup(backupId: string): boolean {
    const removed = store.removeBackup(backupId);
    if (!removed) return false;

    const filePath = this.getBackupFilePath(removed);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  }

  async restoreBackup(backupId: string, restartAfter = true): Promise<void> {
    const backup = store.getBackups().find((b) => b.id === backupId);
    if (!backup) throw new Error('Backup not found');

    const server = store.getServer(backup.serverId);
    if (!server) throw new Error('Target server no longer exists');

    const archivePath = this.getBackupFilePath(backup);
    if (!fs.existsSync(archivePath)) {
      throw new Error('Backup archive file is missing on disk');
    }

    // Check if server was running
    const status = await dockerService.getServerRuntimeStatus(server.id);
    const wasRunning = status.state === 'running';

    if (wasRunning) {
      await dockerService.stopServer(server.id);
    }

    // Create safety snapshot before overwriting
    try {
      await this.createBackup(server.id, 'pre-restore', `Safety snapshot before restoring ${backup.filename}`);
    } catch (err) {
      console.warn('[BackupService] Pre-restore safety snapshot warning:', err);
    }

    const configDir = getServerConfigDir(server.id);
    fs.mkdirSync(configDir, { recursive: true });

    await tar.extract({
      file: archivePath,
      cwd: configDir,
    });

    store.addActivity('backup', `Restored backup "${backup.filename}" to "${server.name}"`);
    store.save();

    if (wasRunning && restartAfter) {
      await dockerService.startServer(server);
    }
  }
}

export const backupService = new BackupService();
