import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  getBackupsDir,
  getServersRootDir,
  getStateFilePath,
  getVaultDir,
  config,
} from './config.js';
import type {
  ActivityEntry,
  BackupEntry,
  BackupPolicy,
  ManagerState,
  ServerConfig,
  UpdatePolicy,
} from './types.js';

const defaultState: ManagerState = {
  servers: [],
  backups: [],
  backupPolicy: {
    enabled: true,
    cronExpression: '0 */6 * * *', // Every 6 hours
    retentionCount: 15,
    backupBeforeUpdate: true,
  },
  updatePolicy: {
    autoCheckEnabled: true,
    checkCronExpression: '0 * * * *', // Every hour
    autoUpdateEnabled: false,
    lastCheckedAt: null,
    lastUpdatedAt: null,
    installedBuildId: null,
    latestBuildId: null,
    latestTimeUpdated: null,
    updateAvailable: false,
    isUpdating: false,
    updateLog: [],
  },
  activity: [],
};

class Store {
  private state: ManagerState = structuredClone(defaultState);

  init(): void {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.mkdirSync(getServersRootDir(), { recursive: true });
    fs.mkdirSync(getVaultDir(), { recursive: true });
    fs.mkdirSync(getBackupsDir(), { recursive: true });

    const statePath = getStateFilePath();
    if (fs.existsSync(statePath)) {
      try {
        const raw = fs.readFileSync(statePath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<ManagerState>;
        this.state = {
          servers: parsed.servers ?? [],
          backups: parsed.backups ?? [],
          backupPolicy: { ...defaultState.backupPolicy, ...(parsed.backupPolicy ?? {}) },
          updatePolicy: {
            ...defaultState.updatePolicy,
            ...(parsed.updatePolicy ?? {}),
            isUpdating: false,
          },
          activity: parsed.activity ?? [],
        };
      } catch (err) {
        console.error('[Store] Failed to load state file, starting fresh:', err);
        this.state = structuredClone(defaultState);
      }
    } else {
      this.save();
    }
  }

  save(): void {
    const statePath = getStateFilePath();
    const tmpPath = `${statePath}.tmp`;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, statePath);
  }

  getState(): ManagerState {
    return this.state;
  }

  getServers(): ServerConfig[] {
    return this.state.servers;
  }

  getServer(id: string): ServerConfig | undefined {
    return this.state.servers.find((s) => s.id === id);
  }

  addServer(server: ServerConfig): void {
    this.state.servers.push(server);
    this.addActivity('server', `Created server "${server.name}" (World: ${server.worldName}, Port: ${server.port})`);
    this.save();
  }

  updateServer(id: string, updated: ServerConfig): void {
    const idx = this.state.servers.findIndex((s) => s.id === id);
    if (idx !== -1) {
      this.state.servers[idx] = updated;
      this.addActivity('server', `Updated configuration for "${updated.name}"`);
      this.save();
    }
  }

  deleteServer(id: string): void {
    const target = this.getServer(id);
    this.state.servers = this.state.servers.filter((s) => s.id !== id);
    if (target) {
      this.addActivity('server', `Removed server "${target.name}"`);
    }
    this.save();
  }

  getBackups(): BackupEntry[] {
    return this.state.backups;
  }

  addBackup(entry: BackupEntry): void {
    this.state.backups.unshift(entry);
    this.addActivity('backup', `Created ${entry.trigger} backup for "${entry.serverName}" (${entry.worldName})`);
    this.save();
  }

  removeBackup(id: string): BackupEntry | undefined {
    const idx = this.state.backups.findIndex((b) => b.id === id);
    if (idx === -1) return undefined;
    const [removed] = this.state.backups.splice(idx, 1);
    this.save();
    return removed;
  }

  getBackupPolicy(): BackupPolicy {
    return this.state.backupPolicy;
  }

  updateBackupPolicy(patch: Partial<BackupPolicy>): BackupPolicy {
    this.state.backupPolicy = { ...this.state.backupPolicy, ...patch };
    this.addActivity('backup', 'Updated automated backup schedule policy');
    this.save();
    return this.state.backupPolicy;
  }

  getUpdatePolicy(): UpdatePolicy {
    return this.state.updatePolicy;
  }

  updateUpdatePolicy(patch: Partial<UpdatePolicy>): UpdatePolicy {
    this.state.updatePolicy = { ...this.state.updatePolicy, ...patch };
    this.save();
    return this.state.updatePolicy;
  }

  addActivity(type: ActivityEntry['type'], message: string): void {
    this.state.activity.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      message,
    });
    if (this.state.activity.length > 100) {
      this.state.activity = this.state.activity.slice(0, 100);
    }
  }

  getNextAvailablePort(base = 2456): number {
    const used = new Set<number>();
    for (const s of this.state.servers) {
      used.add(s.port);
      used.add(s.port + 1);
    }
    let candidate = base;
    while (used.has(candidate) || used.has(candidate + 1)) {
      candidate += 2;
    }
    return candidate;
  }
}

export const store = new Store();
