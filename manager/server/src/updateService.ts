import fs from 'node:fs';
import path from 'node:path';
import cron, { type ScheduledTask } from 'node-cron';
import { config } from './config.js';
import { store } from './store.js';
import { dockerService } from './dockerService.js';
import { backupService } from './backupService.js';
import type { UpdatePolicy } from './types.js';

const STEAMCMD_INFO_URL = 'https://api.steamcmd.net/v1/info/896660';

class UpdateService {
  private cronTask: ScheduledTask | null = null;

  init(): void {
    this.readInstalledBuildId();
    this.reschedule();
    // Run an initial background check shortly after startup
    setTimeout(() => {
      this.checkForUpdates().catch((err) => {
        console.warn('[UpdateService] Initial update check failed:', (err as Error).message);
      });
    }, 5000);
  }

  reschedule(): void {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    const policy = store.getUpdatePolicy();
    if (!policy.autoCheckEnabled) return;

    if (!cron.validate(policy.checkCronExpression)) {
      console.warn('[UpdateService] Invalid cron expression:', policy.checkCronExpression);
      return;
    }

    this.cronTask = cron.schedule(policy.checkCronExpression, async () => {
      try {
        const result = await this.checkForUpdates();
        if (result.updateAvailable && store.getUpdatePolicy().autoUpdateEnabled && !result.isUpdating) {
          console.log('[UpdateService] New Valheim build detected — starting auto-update...');
          await this.performUpdate();
        }
      } catch (err) {
        console.error('[UpdateService] Scheduled update check failed:', err);
      }
    });
  }

  readInstalledBuildId(): string | null {
    // 1. Check .pok_build.json written by entrypoint.sh
    const jsonPath = path.join(config.gameFilesMountPath, '.pok_build.json');
    if (fs.existsSync(jsonPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { buildId?: string };
        if (data.buildId) {
          store.updateUpdatePolicy({ installedBuildId: data.buildId });
          return data.buildId;
        }
      } catch {
        // fallback to acf
      }
    }

    // 2. Check steamapps/appmanifest_896660.acf directly
    const acfPath = path.join(config.gameFilesMountPath, 'steamapps', 'appmanifest_896660.acf');
    if (fs.existsSync(acfPath)) {
      try {
        const content = fs.readFileSync(acfPath, 'utf-8');
        const match = content.match(/"buildid"\s+"(\d+)"/);
        if (match) {
          store.updateUpdatePolicy({ installedBuildId: match[1] });
          return match[1];
        }
      } catch {
        // ignore
      }
    }

    return store.getUpdatePolicy().installedBuildId;
  }

  async checkForUpdates(): Promise<UpdatePolicy> {
    const installedBuildId = this.readInstalledBuildId();

    const resp = await fetch(STEAMCMD_INFO_URL, {
      headers: { 'User-Agent': 'POK-Valheim-Manager/1.0' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      throw new Error(`SteamCMD API returned HTTP ${resp.status}`);
    }

    const payload = (await resp.json()) as {
      data?: {
        '896660'?: {
          depots?: {
            branches?: {
              public?: {
                buildid?: string;
                timeupdated?: string;
              };
            };
          };
        };
      };
    };

    const publicBranch = payload.data?.['896660']?.depots?.branches?.public;
    const latestBuildId = publicBranch?.buildid ? String(publicBranch.buildid) : null;
    const latestTimeUpdated = publicBranch?.timeupdated
      ? parseInt(publicBranch.timeupdated, 10)
      : null;

    const updateAvailable = Boolean(
      latestBuildId && (!installedBuildId || installedBuildId !== latestBuildId)
    );

    return store.updateUpdatePolicy({
      lastCheckedAt: new Date().toISOString(),
      installedBuildId,
      latestBuildId,
      latestTimeUpdated,
      updateAvailable,
    });
  }

  updatePolicy(patch: Partial<UpdatePolicy>): UpdatePolicy {
    if (patch.checkCronExpression && !cron.validate(patch.checkCronExpression)) {
      throw new Error(`Invalid cron expression: ${patch.checkCronExpression}`);
    }
    const updated = store.updateUpdatePolicy(patch);
    this.reschedule();
    store.addActivity('update', 'Updated auto-update settings');
    store.save();
    return updated;
  }

  async performUpdate(): Promise<void> {
    const current = store.getUpdatePolicy();
    if (current.isUpdating) {
      throw new Error('An update is already in progress');
    }

    const logs: string[] = [];
    const pushLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      logs.push(line);
      if (logs.length > 200) logs.shift();
      store.updateUpdatePolicy({ updateLog: [...logs] });
    };

    store.updateUpdatePolicy({ isUpdating: true, updateLog: [] });
    store.addActivity('update', 'Started Valheim Dedicated Server update via SteamCMD');
    store.save();

    const serversToRestart: string[] = [];

    try {
      const servers = store.getServers();
      const backupBeforeUpdate = store.getBackupPolicy().backupBeforeUpdate;

      // 1. Identify running servers, backup if enabled, and stop them gracefully
      for (const server of servers) {
        const status = await dockerService.getServerRuntimeStatus(server.id);
        if (status.state === 'running') {
          serversToRestart.push(server.id);
          pushLog(`Stopping server "${server.name}" gracefully (saving world)...`);
          await dockerService.stopServer(server.id);
          if (backupBeforeUpdate) {
            pushLog(`Creating pre-update backup for "${server.name}"...`);
            await backupService.createBackup(server.id, 'pre-update', 'Pre-update safety backup');
          }
        }
      }

      // 2. Run one-shot SteamCMD updater container against shared gamefiles volume
      pushLog('Running SteamCMD update for AppID 896660...');
      await dockerService.runSteamUpdateContainer((line) => pushLog(line));

      // 3. Re-read installed build ID
      const newBuildId = this.readInstalledBuildId();
      pushLog(`Update finished! Installed Build ID: ${newBuildId || 'unknown'}`);

      // 4. Restart previously running servers
      for (const serverId of serversToRestart) {
        const srv = store.getServer(serverId);
        if (srv) {
          pushLog(`Restarting server "${srv.name}"...`);
          await dockerService.startServer(srv);
        }
      }

      store.updateUpdatePolicy({
        isUpdating: false,
        lastUpdatedAt: new Date().toISOString(),
        installedBuildId: newBuildId,
        updateAvailable: false,
        updateLog: logs,
      });
      store.addActivity('update', `Valheim updated successfully to build ${newBuildId || 'latest'}`);
      store.save();
    } catch (err) {
      pushLog(`ERROR: ${(err as Error).message}`);
      // Attempt to restart any stopped servers even if update failed
      for (const serverId of serversToRestart) {
        const srv = store.getServer(serverId);
        if (srv) {
          try {
            await dockerService.startServer(srv);
          } catch {
            // ignore
          }
        }
      }
      store.updateUpdatePolicy({ isUpdating: false, updateLog: logs });
      store.addActivity('update', `Valheim update failed: ${(err as Error).message}`);
      store.save();
      throw err;
    }
  }
}

export const updateService = new UpdateService();
