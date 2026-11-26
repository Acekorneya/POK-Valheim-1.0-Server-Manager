export interface WorldModifiers {
  preset: '' | 'normal' | 'casual' | 'easy' | 'hard' | 'hardcore' | 'immersive' | 'hammer';
  combat: '' | 'veryeasy' | 'easy' | 'hard' | 'veryhard';
  deathPenalty: '' | 'casual' | 'veryeasy' | 'easy' | 'hard' | 'hardcore';
  resources: '' | 'muchless' | 'less' | 'more' | 'muchmore' | 'most';
  raids: '' | 'none' | 'muchless' | 'less' | 'more' | 'muchmore';
  portals: '' | 'casual' | 'hard' | 'veryhard';
  noBuildCost: boolean;
  playerEvents: boolean;
  passiveMobs: boolean;
  noMap: boolean;
  fire: boolean;
  dungeonBuild: boolean;
}

export interface ServerConfig {
  id: string;
  name: string;
  description: string;
  worldName: string;
  password: string;
  port: number;
  isPublic: boolean;
  crossplay: boolean;
  saveInterval: number;
  backupsCount: number;
  backupShort: number;
  backupLong: number;
  modsEnabled?: boolean;
  rconEnabled?: boolean;
  rconPort?: number;
  rconPassword?: string;
  updateOnStart: boolean;
  autoStart: boolean;
  modifiers: WorldModifiers;
  extraArgs: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerRuntimeStatus {
  containerId: string | null;
  containerName: string;
  state: 'running' | 'exited' | 'restarting' | 'paused' | 'created' | 'not_created' | 'error';
  statusText: string;
  ready: boolean;
  playersOnline: number;
  onlinePlayerNames: string[];
  worldDay: number | null;
  worldSeed?: string | null;
  lastSavedAt: string | null;
  uptimeSeconds: number | null;
  cpuPercent: number;
  memoryMb: number;
  memoryLimitMb: number;
  joinCode?: string | null;
}

export interface ServerWithStatus extends ServerConfig {
  runtime: ServerRuntimeStatus;
}

export interface WorldSaveInfo {
  name: string;
  location: 'vault' | string; // 'vault' or serverId
  locationLabel: string;
  hasDb: boolean;
  hasFwl: boolean;
  isFolder?: boolean;
  seed?: string | null;
  totalSizeBytes: number;
  lastModified: string;
  isActiveOnServer?: boolean;
}

export interface ThunderstoreModSummary {
  uuid4: string;
  name: string;
  fullName: string;
  owner: string;
  description: string;
  icon: string;
  packageUrl: string;
  categories: string[];
  totalDownloads: number;
  ratingScore: number;
  dateUpdated: string;
  latestVersion: string;
  downloadUrl: string;
  dependencies: string[];
  isDeprecated: boolean;
}

export interface InstalledMod {
  fullName: string;
  name: string;
  owner: string;
  version: string;
  icon?: string;
  description?: string;
  enabled: boolean;
  installedAt: string;
  source: 'thunderstore' | 'custom';
  pluginDirName: string;
}

export interface ServerModsState {
  serverId: string;
  modsEnabled: boolean;
  bepInExInstalled: boolean;
  bepInExVersion: string | null;
  mods: InstalledMod[];
  configFiles: string[];
}

export interface BackupEntry {
  id: string;
  serverId: string;
  serverName: string;
  worldName: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  trigger: 'manual' | 'scheduled' | 'pre-update' | 'pre-restore';
  note?: string;
}

export interface BackupPolicy {
  enabled: boolean;
  cronExpression: string;
  retentionCount: number;
  backupBeforeUpdate: boolean;
}

export type UpdatePlayerPolicy = 'wait_until_empty' | 'countdown' | 'immediate';

export interface UpdatePolicy {
  autoCheckEnabled: boolean;
  checkCronExpression: string;
  autoUpdateEnabled: boolean;
  whenPlayersOnline: UpdatePlayerPolicy;
  countdownMinutes: number;
  discordWebhookUrl: string;
  rconEnabled: boolean;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  rconCommandTemplate: string;
  pendingState: 'idle' | 'waiting_for_empty' | 'countdown' | 'updating';
  pendingMessage: string | null;
  lastCheckedAt: string | null;
  lastUpdatedAt: string | null;
  installedBuildId: string | null;
  latestBuildId: string | null;
  latestTimeUpdated: number | null;
  updateAvailable: boolean;
  isUpdating: boolean;
  updateLog: string[];
}

export interface PlayerLists {
  adminlist: string;
  bannedlist: string;
  permittedlist: string;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  type: 'server' | 'world' | 'backup' | 'update' | 'system';
  message: string;
}

export interface ManagerState {
  servers: ServerConfig[];
  backups: BackupEntry[];
  backupPolicy: BackupPolicy;
  updatePolicy: UpdatePolicy;
  activity: ActivityEntry[];
}
