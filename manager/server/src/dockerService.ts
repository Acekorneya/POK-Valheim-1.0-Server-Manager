import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Docker from 'dockerode';
import { config, getServerConfigDir } from './config.js';
import type { ServerConfig, ServerRuntimeStatus } from './types.js';

export const CONTAINER_PREFIX = 'pok-valheim-srv-';

class DockerService {
  private docker: Docker;
  private resolvedHostDataDir: string | null = null;
  private dockerAvailable = true;

  constructor() {
    this.docker = new Docker({ socketPath: config.dockerSocket });
  }

  async init(): Promise<void> {
    try {
      await this.docker.ping();
      this.dockerAvailable = true;
      await this.resolveHostDataDir();
      await this.ensureGameFilesVolume();
      await this.ensureSelfOnBridgeNetwork();
    } catch (err) {
      this.dockerAvailable = false;
      console.warn('[DockerService] Docker daemon not reachable at', config.dockerSocket, (err as Error).message);
    }
  }

  /**
   * Ensures the manager container is also attached to the default 'bridge' network
   * so it can reach Valheim server containers directly by internal Docker IP (for RCON)
   * without being blocked by host UFW firewalls.
   */
  private async ensureSelfOnBridgeNetwork(): Promise<void> {
    try {
      const hostname = os.hostname();
      const selfContainer = this.docker.getContainer(hostname);
      const info = await selfContainer.inspect();
      if (!info.NetworkSettings?.Networks?.bridge) {
        const bridgeNet = this.docker.getNetwork('bridge');
        await bridgeNet.connect({ Container: info.Id });
        console.log('[DockerService] Connected manager container to Docker bridge network for internal RCON.');
      }
    } catch {
      // Running outside Docker or already connected
    }
  }

  async getContainerBridgeIp(serverId: string): Promise<string | null> {
    if (!this.dockerAvailable) return null;
    const container = await this.findContainer(serverId);
    if (!container) return null;
    try {
      const info = await container.inspect();
      const nets = info.NetworkSettings?.Networks;
      if (nets?.bridge?.IPAddress) return nets.bridge.IPAddress;
      const firstNet = nets ? Object.values(nets).find((n) => n.IPAddress) : null;
      return firstNet?.IPAddress || null;
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return this.dockerAvailable;
  }

  /**
   * When running inside Docker (DooD), sibling containers need HOST paths for bind mounts.
   * We auto-discover the host path mounted to DATA_DIR by inspecting our own container.
   */
  private async resolveHostDataDir(): Promise<string> {
    if (config.hostDataDir) {
      this.resolvedHostDataDir = config.hostDataDir;
      return this.resolvedHostDataDir;
    }

    try {
      const hostname = os.hostname();
      const selfContainer = this.docker.getContainer(hostname);
      const info = await selfContainer.inspect();
      const dataMount = info.Mounts?.find(
        (m) => m.Destination === config.dataDir || m.Destination === '/data'
      );
      if (dataMount && dataMount.Source) {
        this.resolvedHostDataDir = dataMount.Source;
        console.log('[DockerService] Auto-discovered HOST_DATA_DIR:', this.resolvedHostDataDir);
        return this.resolvedHostDataDir;
      }
    } catch {
      // Running directly on host (dev mode)
    }

    this.resolvedHostDataDir = config.dataDir;
    return this.resolvedHostDataDir;
  }

  private async ensureGameFilesVolume(): Promise<void> {
    try {
      await this.docker.getVolume(config.gameFilesVolume).inspect();
    } catch {
      await this.docker.createVolume({
        Name: config.gameFilesVolume,
        Labels: { 'pok-valheim.managed': 'true', 'pok-valheim.role': 'gamefiles' },
      });
    }
  }

  getContainerName(serverId: string): string {
    return `${CONTAINER_PREFIX}${serverId}`;
  }

  private getHostServerConfigDir(serverId: string): string {
    const base = this.resolvedHostDataDir || config.hostDataDir || config.dataDir;
    return path.posix.join(base.replace(/\\/g, '/'), 'servers', serverId, 'config');
  }

  private buildContainerEnv(server: ServerConfig): string[] {
    const m = server.modifiers;
    return [
      `TZ=${config.tz}`,
      `SERVER_NAME=${server.name}`,
      `WORLD_NAME=${server.worldName}`,
      `SERVER_PASS=${server.password}`,
      `SERVER_PORT=${server.port}`,
      `SERVER_PUBLIC=${server.isPublic ? '1' : '0'}`,
      `CROSSPLAY=${server.crossplay ? 'true' : 'false'}`,
      `SAVE_INTERVAL=${server.saveInterval}`,
      `BACKUPS=${server.backupsCount}`,
      `BACKUPSHORT=${server.backupShort || 7200}`,
      `BACKUPLONG=${server.backupLong || 43200}`,
      `UPDATE_ON_START=${server.updateOnStart ? 'true' : 'false'}`,
      `PRESET=${m.preset || ''}`,
      `MODIFIER_COMBAT=${m.combat || ''}`,
      `MODIFIER_DEATHPENALTY=${m.deathPenalty || ''}`,
      `MODIFIER_RESOURCES=${m.resources || ''}`,
      `MODIFIER_RAIDS=${m.raids || ''}`,
      `MODIFIER_PORTALS=${m.portals || ''}`,
      `KEY_NOBUILDCOST=${m.noBuildCost ? 'true' : 'false'}`,
      `KEY_PLAYEREVENTS=${m.playerEvents ? 'true' : 'false'}`,
      `KEY_PASSIVEMOBS=${m.passiveMobs ? 'true' : 'false'}`,
      `KEY_NOMAP=${m.noMap ? 'true' : 'false'}`,
      `KEY_FIRE=${m.fire ? 'true' : 'false'}`,
      `KEY_DUNGEONBUILD=${m.dungeonBuild ? 'true' : 'false'}`,
      `MODS_ENABLED=${server.modsEnabled ? 'true' : 'false'}`,
      `POK_RCON_ENABLED=${server.rconEnabled ? 'true' : 'false'}`,
      `POK_RCON_PORT=${server.rconPort || server.port + 2}`,
      `POK_RCON_PASSWORD=${server.rconPassword || ''}`,
      `EXTRA_ARGS=${server.extraArgs || ''}`,
    ];
  }

  async findContainer(serverId: string): Promise<Docker.Container | null> {
    if (!this.dockerAvailable) return null;
    const name = this.getContainerName(serverId);
    const containers = await this.docker.listContainers({
      all: true,
      filters: { name: [`^/${name}$`] },
    });
    if (containers.length === 0) return null;
    return this.docker.getContainer(containers[0].Id);
  }

  async createOrRecreateContainer(server: ServerConfig, autoStart = false): Promise<void> {
    if (!this.dockerAvailable) {
      throw new Error('Docker daemon is not reachable');
    }

    // Ensure local config dir exists
    const localConfigDir = getServerConfigDir(server.id);
    fs.mkdirSync(path.join(localConfigDir, 'worlds_local'), { recursive: true });

    const existing = await this.findContainer(server.id);
    if (existing) {
      const info = await existing.inspect();
      if (info.State.Running) {
        await existing.stop({ t: 45 });
      }
      await existing.remove({ force: true });
    }

    const hostConfigDir = this.getHostServerConfigDir(server.id);
    const port1 = `${server.port}/udp`;
    const port2 = `${server.port + 1}/udp`;

    const exposedPorts: Record<string, Record<string, never>> = {
      [port1]: {},
      [port2]: {},
    };
    const portBindings: Record<string, { HostPort: string }[]> = {
      [port1]: [{ HostPort: String(server.port) }],
      [port2]: [{ HostPort: String(server.port + 1) }],
    };

    if (server.rconEnabled && server.rconPort) {
      const rconKey = `${server.rconPort}/tcp`;
      exposedPorts[rconKey] = {};
      portBindings[rconKey] = [{ HostPort: String(server.rconPort) }];
    }

    const container = await this.docker.createContainer({
      name: this.getContainerName(server.id),
      Image: config.valheimImage,
      Env: this.buildContainerEnv(server),
      StopSignal: 'SIGINT',
      StopTimeout: 45,
      Labels: {
        'pok-valheim.managed': 'true',
        'pok-valheim.server-id': server.id,
        'pok-valheim.server-name': server.name,
      },
      ExposedPorts: exposedPorts,
      HostConfig: {
        RestartPolicy: {
          Name: server.autoStart ? 'unless-stopped' : 'no',
        },
        Binds: [
          `${hostConfigDir}:/config`,
          `${config.gameFilesVolume}:/opt/valheim`,
        ],
        PortBindings: portBindings,
      },
    });

    if (autoStart) {
      await container.start();
    }
  }

  async startServer(server: ServerConfig): Promise<void> {
    if (!this.dockerAvailable) throw new Error('Docker daemon is not reachable');
    let container = await this.findContainer(server.id);
    if (!container) {
      await this.createOrRecreateContainer(server, true);
      return;
    }
    const info = await container.inspect();
    if (!info.State.Running) {
      await container.start();
    }
  }

  async stopServer(serverId: string): Promise<void> {
    if (!this.dockerAvailable) throw new Error('Docker daemon is not reachable');
    const container = await this.findContainer(serverId);
    if (!container) return;
    const info = await container.inspect();
    if (info.State.Running) {
      // 45s timeout so Valheim has plenty of time to save on SIGINT
      await container.stop({ t: 45 });
    }
  }

  async restartServer(server: ServerConfig): Promise<void> {
    await this.stopServer(server.id);
    await this.startServer(server);
  }

  async removeContainer(serverId: string): Promise<void> {
    if (!this.dockerAvailable) return;
    const container = await this.findContainer(serverId);
    if (!container) return;
    try {
      const info = await container.inspect();
      if (info.State.Running) {
        await container.stop({ t: 45 });
      }
      await container.remove({ force: true });
    } catch (err) {
      console.error(`[DockerService] Error removing container for ${serverId}:`, err);
    }
  }

  async getServerRuntimeStatus(serverId: string): Promise<ServerRuntimeStatus> {
    const containerName = this.getContainerName(serverId);
    const emptyBase: ServerRuntimeStatus = {
      containerId: null,
      containerName,
      state: 'not_created',
      statusText: 'Not Created',
      ready: false,
      playersOnline: 0,
      onlinePlayerNames: [],
      worldDay: null,
      lastSavedAt: null,
      uptimeSeconds: null,
      cpuPercent: 0,
      memoryMb: 0,
      memoryLimitMb: 0,
      joinCode: null,
    };

    if (!this.dockerAvailable) {
      return { ...emptyBase, statusText: 'Docker unavailable' };
    }

    const container = await this.findContainer(serverId);
    if (!container) {
      return emptyBase;
    }

    try {
      const info = await container.inspect();
      const rawState = info.State.Status as ServerRuntimeStatus['state'];
      let uptimeSeconds: number | null = null;
      if (info.State.Running && info.State.StartedAt) {
        const started = new Date(info.State.StartedAt).getTime();
        uptimeSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
      }

      let cpuPercent = 0;
      let memoryMb = 0;
      let memoryLimitMb = 0;
      let joinCode: string | null = null;
      let ready = false;
      let playersOnline = 0;
      let onlinePlayerNames: string[] = [];
      let worldDay: number | null = null;
      let lastSavedAt: string | null = null;

      if (info.State.Running) {
        try {
          const stats = await container.stats({ stream: false });
          const cpuDelta =
            (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
            (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
          const sysDelta =
            (stats.cpu_stats?.system_cpu_usage ?? 0) -
            (stats.precpu_stats?.system_cpu_usage ?? 0);
          const onlineCpus = stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
          if (sysDelta > 0 && cpuDelta > 0) {
            cpuPercent = Math.round(((cpuDelta / sysDelta) * onlineCpus * 100) * 10) / 10;
          }
          const memUsage = stats.memory_stats?.usage ?? 0;
          const memCache = stats.memory_stats?.stats?.cache ?? 0;
          memoryMb = Math.round(Math.max(0, memUsage - memCache) / (1024 * 1024));
          memoryLimitMb = Math.round((stats.memory_stats?.limit ?? 0) / (1024 * 1024));
        } catch {
          // Ignore transient stats errors
        }

        try {
          const recentLogs = await this.getLogsTail(serverId, 400);
          const parsed = parseValheimTelemetry(recentLogs);
          joinCode = parsed.joinCode;
          ready = parsed.ready;
          playersOnline = parsed.playersOnline;
          onlinePlayerNames = parsed.onlinePlayerNames;
          worldDay = parsed.worldDay;
          lastSavedAt = parsed.lastSavedAt;
        } catch {
          // Ignore
        }
      }

      const statusText = info.State.Running
        ? ready
          ? 'Online'
          : 'Starting...'
        : rawState === 'exited'
          ? 'Stopped'
          : rawState;

      return {
        containerId: info.Id.slice(0, 12),
        containerName,
        state: rawState,
        statusText,
        ready,
        playersOnline,
        onlinePlayerNames,
        worldDay,
        lastSavedAt,
        uptimeSeconds,
        cpuPercent,
        memoryMb,
        memoryLimitMb,
        joinCode,
      };
    } catch (err) {
      return {
        ...emptyBase,
        state: 'error',
        statusText: (err as Error).message,
      };
    }
  }

  async getLogsTail(serverId: string, tail = 200): Promise<string> {
    if (!this.dockerAvailable) return '';
    const container = await this.findContainer(serverId);
    if (!container) return '';
    const buf = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: false,
    });
    return stripDockerLogHeaders(buf);
  }

  async streamLogs(
    serverId: string,
    onLine: (line: string) => void,
    onClose: () => void
  ): Promise<() => void> {
    const container = await this.findContainer(serverId);
    if (!container) {
      onLine('[POK-Valheim] Container not created yet.');
      onClose();
      return () => {};
    }

    const stream = (await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 150,
    })) as unknown as NodeJS.ReadableStream;

    stream.on('data', (chunk: Buffer) => {
      const text = stripDockerLogHeaders(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) onLine(line);
      }
    });
    stream.on('end', onClose);
    stream.on('error', onClose);

    return () => {
      const s = stream as unknown as { destroy?: () => void };
      if (typeof s.destroy === 'function') s.destroy();
    };
  }

  /**
   * Runs a one-shot updater container using the Valheim image with UPDATE_ONLY=true
   * against the shared gamefiles Docker volume.
   */
  async runSteamUpdateContainer(onLog: (line: string) => void): Promise<void> {
    if (!this.dockerAvailable) {
      throw new Error('Docker daemon is not reachable');
    }

    const updaterName = 'pok-valheim-updater';
    // Cleanup any stale updater container
    try {
      const stale = this.docker.getContainer(updaterName);
      await stale.remove({ force: true });
    } catch {
      // Not present
    }

    onLog('Creating SteamCMD updater container...');
    const container = await this.docker.createContainer({
      name: updaterName,
      Image: config.valheimImage,
      Env: [`UPDATE_ONLY=true`, `TZ=${config.tz}`],
      Labels: { 'pok-valheim.managed': 'true', 'pok-valheim.role': 'updater' },
      HostConfig: {
        AutoRemove: false,
        Binds: [`${config.gameFilesVolume}:/opt/valheim`],
      },
    });

    await container.start();

    const logStream = (await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    })) as unknown as NodeJS.ReadableStream;

    logStream.on('data', (chunk: Buffer) => {
      const text = stripDockerLogHeaders(chunk);
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLog(line);
      }
    });

    const waitResult = await container.wait();
    try {
      await container.remove({ force: true });
    } catch {
      // ignore
    }

    if (waitResult.StatusCode !== 0) {
      throw new Error(`SteamCMD updater exited with code ${waitResult.StatusCode}`);
    }
  }
}

/**
 * Docker multiplexed stream frames have an 8-byte header: [streamType, 0, 0, 0, size(4 bytes BE)].
 * This helper safely strips those headers if present.
 */
function stripDockerLogHeaders(input: Buffer | string): string {
  if (typeof input === 'string') return input;
  const chunks: string[] = [];
  let offset = 0;
  while (offset + 8 <= input.length) {
    const streamType = input[offset];
    if ((streamType === 1 || streamType === 2) && input[offset + 1] === 0 && input[offset + 2] === 0 && input[offset + 3] === 0) {
      const size = input.readUInt32BE(offset + 4);
      offset += 8;
      if (offset + size <= input.length) {
        chunks.push(input.subarray(offset, offset + size).toString('utf-8'));
        offset += size;
        continue;
      }
    }
    // Fallback: not multiplexed
    return input.toString('utf-8');
  }
  return chunks.length > 0 ? chunks.join('') : input.toString('utf-8');
}

export const dockerService = new DockerService();

function parseValheimTelemetry(logs: string): {
  ready: boolean;
  joinCode: string | null;
  playersOnline: number;
  onlinePlayerNames: string[];
  worldDay: number | null;
  lastSavedAt: string | null;
} {
  let ready = false;
  let joinCode: string | null = null;
  let playersOnline = 0;
  let worldDay: number | null = null;
  let lastSavedAt: string | null = null;
  const activePlayers = new Set<string>();

  for (const line of logs.split(/\r?\n/)) {
    if (
      line.includes('Game server connected') ||
      line.includes('Opened Steam server') ||
      line.includes('Session "')
    ) {
      ready = true;
    }

    const codeMatch = line.match(/join code\s+(\d+)/i);
    if (codeMatch) joinCode = codeMatch[1];

    const connMatch = line.match(/Connections\s+(\d+)\s+ZDOS/i);
    if (connMatch) {
      playersOnline = parseInt(connMatch[1], 10);
      if (playersOnline === 0) activePlayers.clear();
    }

    const zdoMatch = line.match(/Got character ZDOID from\s+(.+?)\s+:\s+(\d+):(\d+)/i);
    if (zdoMatch) {
      const playerName = zdoMatch[1].trim();
      const zdoId = zdoMatch[2];
      if (zdoId === '0') {
        // Player died or disconnected
      } else if (playerName) {
        activePlayers.add(playerName);
      }
    }

    const saveMatch = line.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}):\s+World saved/i);
    if (saveMatch) {
      lastSavedAt = saveMatch[1];
    }

    const dayMatch = line.match(/Day\s+(\d+)/i);
    if (dayMatch && line.toLowerCase().includes('new day')) {
      worldDay = parseInt(dayMatch[1], 10);
    }
  }

  const onlinePlayerNames = Array.from(activePlayers);
  if (playersOnline === 0 && onlinePlayerNames.length > 0) {
    playersOnline = onlinePlayerNames.length;
  }

  return { ready, joinCode, playersOnline, onlinePlayerNames, worldDay, lastSavedAt };
}
