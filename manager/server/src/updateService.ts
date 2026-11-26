import fs from 'node:fs';
import path from 'node:path';
import cron, { type ScheduledTask } from 'node-cron';
import { config } from './config.js';
import { store } from './store.js';
import { dockerService } from './dockerService.js';
import { backupService } from './backupService.js';
import { sendDiscordWebhook, sendRconCommand } from './notificationService.js';
import type { UpdatePolicy } from './types.js';

const STEAMCMD_INFO_URL = 'https://api.steamcmd.net/v1/info/896660';

class UpdateService {
  private cronTask: ScheduledTask | null = null;
  private cancelRequested = false;

  init(): void {
    this.readInstalledBuildId();
    this.reschedule();
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
        const latest = store.getUpdatePolicy();
        if (
          result.updateAvailable &&
          latest.autoUpdateEnabled &&
          !latest.isUpdating &&
          latest.pendingState === 'idle'
        ) {
          console.log('[UpdateService] New Valheim build detected — triggering player-aware auto-update...');
          this.scheduleOrRunUpdate(false).catch((err) => {
            console.error('[UpdateService] Auto-update workflow failed:', err);
          });
        }
      } catch (err) {
        console.error('[UpdateService] Scheduled update check failed:', err);
      }
    });
  }

  readInstalledBuildId(): string | null {
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
    store.addActivity('update', 'Updated auto-update & notification settings');
    store.save();
    return updated;
  }

  async getTotalOnlinePlayers(): Promise<{ total: number; names: string[] }> {
    let total = 0;
    const names: string[] = [];
    for (const server of store.getServers()) {
      try {
        const st = await dockerService.getServerRuntimeStatus(server.id);
        if (st.state === 'running' && st.playersOnline > 0) {
          total += st.playersOnline;
          names.push(...st.onlinePlayerNames);
        }
      } catch {
        // ignore
      }
    }
    return { total, names };
  }

  async broadcastNotice(
    title: string,
    message: string,
    color = 0xf59e0b
  ): Promise<{ discord: string; rcon: string }> {
    const policy = store.getUpdatePolicy();
    const results = { discord: 'disabled', rcon: 'disabled' };

    if (policy.discordWebhookUrl?.trim()) {
      try {
        await sendDiscordWebhook(policy.discordWebhookUrl, title, message, color);
        results.discord = 'sent';
      } catch (err) {
        results.discord = `error: ${(err as Error).message}`;
      }
    }

    if (policy.rconEnabled && policy.rconHost && policy.rconPort) {
      try {
        const template = policy.rconCommandTemplate?.trim() || 'say {message}';
        const cmd = template.replace(/\{message\}/g, message);
        await sendRconCommand(
          {
            host: policy.rconHost.trim(),
            port: Number(policy.rconPort),
            password: policy.rconPassword || '',
          },
          cmd
        );
        results.rcon = 'sent';
      } catch (err) {
        results.rcon = `error: ${(err as Error).message}`;
      }
    }

    // Also broadcast to any individual realm that has Built-In RCON enabled
    for (const srv of store.getServers()) {
      if (srv.rconEnabled && srv.rconPort && srv.rconPassword) {
        try {
          const containerIp = await dockerService.getContainerBridgeIp(srv.id);
          const host = containerIp || config.publicHost || '127.0.0.1';
          const template = policy.rconCommandTemplate?.trim() || 'say {message}';
          const cmd = template.replace(/\{message\}/g, message);
          await sendRconCommand(
            { host, port: Number(srv.rconPort), password: srv.rconPassword },
            cmd
          );
          results.rcon = 'sent';
        } catch {
          // ignore if server is stopped
        }
      }
    }

    return results;
  }

  cancelPendingUpdate(): void {
    this.cancelRequested = true;
    const current = store.getUpdatePolicy();
    if (current.pendingState === 'waiting_for_empty' || current.pendingState === 'countdown') {
      store.updateUpdatePolicy({
        pendingState: 'idle',
        pendingMessage: null,
      });
      store.addActivity('update', 'Cancelled pending Valheim server update');
      store.save();
    }
  }

  private async sleepInterruptible(ms: number): Promise<boolean> {
    const step = 1000;
    let elapsed = 0;
    while (elapsed < ms) {
      if (this.cancelRequested) return false;
      await new Promise((r) => setTimeout(r, Math.min(step, ms - elapsed)));
      elapsed += step;
    }
    return !this.cancelRequested;
  }

  async scheduleOrRunUpdate(forceImmediate = false): Promise<void> {
    const policy = store.getUpdatePolicy();
    if (policy.isUpdating || policy.pendingState !== 'idle') {
      throw new Error('An update or countdown is already in progress');
    }

    this.cancelRequested = false;
    const logs: string[] = [];
    const pushLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      logs.push(line);
      if (logs.length > 200) logs.shift();
      store.updateUpdatePolicy({ updateLog: [...logs] });
    };

    const { total, names } = await this.getTotalOnlinePlayers();

    if (!forceImmediate && total > 0) {
      if (policy.whenPlayersOnline === 'wait_until_empty') {
        const msg = `New Valheim update ready! Waiting for ${total} online player(s) to log off before updating.`;
        pushLog(msg);
        store.updateUpdatePolicy({
          pendingState: 'waiting_for_empty',
          pendingMessage: msg,
        });
        await this.broadcastNotice('Valheim Update Pending', msg, 0x38bdf8);

        while (!this.cancelRequested) {
          const ok = await this.sleepInterruptible(60000);
          if (!ok) {
            pushLog('Pending update cancelled by admin.');
            store.updateUpdatePolicy({ pendingState: 'idle', pendingMessage: null });
            return;
          }
          const check = await this.getTotalOnlinePlayers();
          if (check.total === 0) {
            pushLog('All players have logged off — proceeding with Valheim update!');
            break;
          }
          const waitMsg = `Waiting for ${check.total} player(s)${check.names.length ? ` (${check.names.join(', ')})` : ''} to log off...`;
          store.updateUpdatePolicy({ pendingMessage: waitMsg });
        }
      } else if (policy.whenPlayersOnline === 'countdown') {
        const mins = Math.max(1, Math.min(60, Number(policy.countdownMinutes) || 5));
        let remainingSec = mins * 60;
        const milestones = new Set([remainingSec, 600, 300, 180, 120, 60, 30, 10]);

        pushLog(
          `${total} player(s) online${names.length ? ` (${names.join(', ')})` : ''}. Starting ${mins}-minute update countdown...`
        );
        store.updateUpdatePolicy({
          pendingState: 'countdown',
          pendingMessage: `Restarting for update in ${mins}m 0s (${total} online)`,
        });

        while (remainingSec > 0 && !this.cancelRequested) {
          if (milestones.has(remainingSec)) {
            const label =
              remainingSec >= 60
                ? `${Math.ceil(remainingSec / 60)} minute(s)`
                : `${remainingSec} seconds`;
            const notice = `Valheim server will restart for an update in ${label}. Please find a safe spot!`;
            pushLog(`Broadcast: ${notice}`);
            await this.broadcastNotice('Valheim Update Countdown', notice, 0xf59e0b);
          }

          // Check every 15s if server became empty early
          if (remainingSec % 15 === 0) {
            const check = await this.getTotalOnlinePlayers();
            if (check.total === 0) {
              pushLog('All players disconnected early — starting update now!');
              break;
            }
          }

          const m = Math.floor(remainingSec / 60);
          const s = remainingSec % 60;
          store.updateUpdatePolicy({
            pendingMessage: `Restarting for update in ${m}m ${s}s`,
          });

          const ok = await this.sleepInterruptible(1000);
          if (!ok) {
            pushLog('Update countdown cancelled by admin.');
            await this.broadcastNotice(
              'Valheim Update Cancelled',
              'The scheduled server update restart was cancelled by an admin.',
              0x94a3b8
            );
            store.updateUpdatePolicy({ pendingState: 'idle', pendingMessage: null });
            return;
          }
          remainingSec -= 1;
        }
      }
    }

    if (this.cancelRequested) {
      store.updateUpdatePolicy({ pendingState: 'idle', pendingMessage: null });
      return;
    }

    await this.performUpdate(logs);
  }

  async performUpdate(existingLogs: string[] = []): Promise<void> {
    const current = store.getUpdatePolicy();
    if (current.isUpdating) {
      throw new Error('An update is already in progress');
    }

    const logs = [...existingLogs];
    const pushLog = (msg: string) => {
      const line = `[${new Date().toISOString()}] ${msg}`;
      logs.push(line);
      if (logs.length > 200) logs.shift();
      store.updateUpdatePolicy({ updateLog: [...logs] });
    };

    store.updateUpdatePolicy({
      isUpdating: true,
      pendingState: 'updating',
      pendingMessage: 'Updating Valheim via SteamCMD...',
      updateLog: logs,
    });
    store.addActivity('update', 'Started Valheim Dedicated Server update via SteamCMD');
    store.save();

    await this.broadcastNotice(
      'Valheim Update Starting',
      'Saving worlds and updating Valheim Dedicated Server now. Servers will be back online shortly!',
      0xf59e0b
    );

    const serversToRestart: string[] = [];

    try {
      const servers = store.getServers();
      const backupBeforeUpdate = store.getBackupPolicy().backupBeforeUpdate;

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

      pushLog('Running SteamCMD update for AppID 896660...');
      await dockerService.runSteamUpdateContainer((line) => pushLog(line));

      const newBuildId = this.readInstalledBuildId();
      pushLog(`Update finished! Installed Build ID: ${newBuildId || 'unknown'}`);

      for (const serverId of serversToRestart) {
        const srv = store.getServer(serverId);
        if (srv) {
          pushLog(`Restarting server "${srv.name}"...`);
          await dockerService.startServer(srv);
        }
      }

      store.updateUpdatePolicy({
        isUpdating: false,
        pendingState: 'idle',
        pendingMessage: null,
        lastUpdatedAt: new Date().toISOString(),
        installedBuildId: newBuildId,
        updateAvailable: false,
        updateLog: logs,
      });
      store.addActivity('update', `Valheim updated successfully to build ${newBuildId || 'latest'}`);
      store.save();

      await this.broadcastNotice(
        'Valheim Update Complete',
        `Servers are back online on Build ${newBuildId || 'latest'}!`,
        0x10b981
      );
    } catch (err) {
      pushLog(`ERROR: ${(err as Error).message}`);
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
      store.updateUpdatePolicy({
        isUpdating: false,
        pendingState: 'idle',
        pendingMessage: null,
        updateLog: logs,
      });
      store.addActivity('update', `Valheim update failed: ${(err as Error).message}`);
      store.save();
      throw err;
    }
  }
}

export const updateService = new UpdateService();
