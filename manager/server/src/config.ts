import path from 'node:path';

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  hostDataDir: process.env.HOST_DATA_DIR || '',
  valheimImage: process.env.VALHEIM_IMAGE || 'pok-valheim-server:latest',
  gameFilesVolume: process.env.GAME_FILES_VOLUME || 'pok-valheim-gamefiles',
  gameFilesMountPath: process.env.GAME_FILES_MOUNT_PATH || '/opt/valheim-shared',
  dockerSocket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  publicHost: process.env.PUBLIC_HOST || '',
  tz: process.env.TZ || 'UTC',
  auth: {
    enabled: (process.env.POK_AUTH_ENABLED || 'true').toLowerCase() !== 'false',
    username: process.env.POK_ADMIN_USER || 'admin',
    password: process.env.POK_ADMIN_PASS || 'pokvalheim',
    jwtSecret: process.env.POK_JWT_SECRET || 'pok-valheim-change-this-secret-in-env',
  },
};

export function getServersRootDir(): string {
  return path.join(config.dataDir, 'servers');
}

export function getServerConfigDir(serverId: string): string {
  return path.join(config.dataDir, 'servers', serverId, 'config');
}

export function getServerWorldsDir(serverId: string): string {
  return path.join(config.dataDir, 'servers', serverId, 'config', 'worlds_local');
}

export function getVaultDir(): string {
  return path.join(config.dataDir, 'vault');
}

export function getBackupsDir(): string {
  return path.join(config.dataDir, 'backups');
}

export function getStateFilePath(): string {
  return path.join(config.dataDir, 'manager-state.json');
}
