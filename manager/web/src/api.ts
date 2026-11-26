import type {
  ActivityEntry,
  AuthStatus,
  BackupEntry,
  BackupPolicy,
  PlayerLists,
  ServerConfig,
  ServerModsState,
  ServerWithStatus,
  ThunderstoreModSummary,
  UpdatePolicy,
  WorldSaveInfo,
} from './types';

const TOKEN_KEY = 'pok_valheim_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!(init?.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const api = {
  // Auth
  getAuthStatus: () => request<AuthStatus>('/api/auth/status'),
  login: (username: string, password: string) =>
    request<{ token: string; username: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  // Servers
  listServers: () =>
    request<{ dockerAvailable: boolean; nextAvailablePort: number; servers: ServerWithStatus[] }>(
      '/api/servers'
    ),
  createServer: (payload: Partial<ServerConfig> & { startImmediately?: boolean }) =>
    request<ServerWithStatus>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateServer: (id: string, payload: Partial<ServerConfig>) =>
    request<ServerWithStatus>(`/api/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteServer: (id: string, deleteFiles = false) =>
    request<{ ok: boolean }>(`/api/servers/${id}?deleteFiles=${deleteFiles}`, {
      method: 'DELETE',
    }),
  startServer: (id: string) => request<{ ok: boolean }>(`/api/servers/${id}/start`, { method: 'POST' }),
  stopServer: (id: string) => request<{ ok: boolean }>(`/api/servers/${id}/stop`, { method: 'POST' }),
  restartServer: (id: string) =>
    request<{ ok: boolean }>(`/api/servers/${id}/restart`, { method: 'POST' }),
  getServerLogs: (id: string, tail = 250) =>
    request<{ logs: string }>(`/api/servers/${id}/logs?tail=${tail}`),
  getPlayerLists: (id: string) => request<PlayerLists>(`/api/servers/${id}/lists`),
  savePlayerLists: (id: string, lists: PlayerLists) =>
    request<PlayerLists>(`/api/servers/${id}/lists`, {
      method: 'PUT',
      body: JSON.stringify(lists),
    }),
  sendRcon: (id: string, command: string) =>
    request<{ ok: boolean; output: string }>(`/api/servers/${id}/rcon`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),

  // Worlds
  listWorlds: () => request<{ worlds: WorldSaveInfo[] }>('/api/worlds'),
  uploadWorlds: (location: string, files: File[]) => {
    const form = new FormData();
    form.append('location', location);
    for (const f of files) form.append('files', f);
    return request<{ ok: boolean; worlds: string[] }>('/api/worlds/upload', {
      method: 'POST',
      body: form,
    });
  },
  cloneWorld: (payload: {
    sourceLocation: string;
    worldName: string;
    targetLocation: string;
    newWorldName?: string;
  }) =>
    request<{ ok: boolean }>('/api/worlds/clone', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  activateWorld: (payload: { serverId: string; worldName: string; sourceLocation?: string }) =>
    request<{ ok: boolean }>('/api/worlds/activate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteWorld: (location: string, worldName: string) =>
    request<{ ok: boolean }>(
      `/api/worlds/${encodeURIComponent(location)}/${encodeURIComponent(worldName)}`,
      { method: 'DELETE' }
    ),
  getWorldDownloadUrl: (location: string, worldName: string) =>
    `/api/worlds/download/${encodeURIComponent(location)}/${encodeURIComponent(worldName)}?token=${encodeURIComponent(getToken())}`,

  // Backups
  listBackups: () => request<{ backups: BackupEntry[]; policy: BackupPolicy }>('/api/backups'),
  createBackup: (serverId: string, note?: string) =>
    request<BackupEntry>('/api/backups/create', {
      method: 'POST',
      body: JSON.stringify({ serverId, note }),
    }),
  restoreBackup: (id: string, restartAfter = true) =>
    request<{ ok: boolean }>(`/api/backups/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ restartAfter }),
    }),
  deleteBackup: (id: string) =>
    request<{ ok: boolean }>(`/api/backups/${id}`, { method: 'DELETE' }),
  updateBackupPolicy: (patch: Partial<BackupPolicy>) =>
    request<BackupPolicy>('/api/backups/policy', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  getBackupDownloadUrl: (id: string) =>
    `/api/backups/${encodeURIComponent(id)}/download?token=${encodeURIComponent(getToken())}`,

  // Updates
  getUpdateStatus: () => request<UpdatePolicy>('/api/updates'),
  checkUpdates: () => request<UpdatePolicy>('/api/updates/check', { method: 'POST' }),
  runUpdate: (forceImmediate = false) =>
    request<{ ok: boolean }>('/api/updates/run', {
      method: 'POST',
      body: JSON.stringify({ forceImmediate }),
    }),
  cancelUpdate: () => request<{ ok: boolean }>('/api/updates/cancel', { method: 'POST' }),
  testBroadcast: (message?: string) =>
    request<{ ok: boolean; result: { discord: string; rcon: string } }>(
      '/api/updates/test-broadcast',
      { method: 'POST', body: JSON.stringify({ message }) }
    ),
  updateUpdatePolicy: (patch: Partial<UpdatePolicy>) =>
    request<UpdatePolicy>('/api/updates/policy', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // Activity
  getActivity: () => request<{ activity: ActivityEntry[] }>('/api/activity'),

  // Mods (Thunderstore + BepInEx)
  searchModsCatalog: (params: {
    search?: string;
    sort?: 'popular' | 'latest' | 'rating';
    category?: string;
    page?: number;
    limit?: number;
    refresh?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.sort) q.set('sort', params.sort);
    if (params.category && params.category !== 'all') q.set('category', params.category);
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.refresh) q.set('refresh', 'true');
    return request<{
      total: number;
      page: number;
      limit: number;
      categories: string[];
      mods: ThunderstoreModSummary[];
    }>(`/api/mods/catalog?${q.toString()}`);
  },
  getServerMods: (serverId: string) =>
    request<ServerModsState>(`/api/mods/server/${encodeURIComponent(serverId)}`),
  setServerModsEnabled: (serverId: string, enabled: boolean) =>
    request<ServerModsState>(`/api/mods/server/${encodeURIComponent(serverId)}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  installMod: (serverId: string, fullName: string, installDependencies = true) =>
    request<ServerModsState>(`/api/mods/server/${encodeURIComponent(serverId)}/install`, {
      method: 'POST',
      body: JSON.stringify({ fullName, installDependencies }),
    }),
  toggleMod: (serverId: string, fullName: string, enabled: boolean) =>
    request<ServerModsState>(`/api/mods/server/${encodeURIComponent(serverId)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ fullName, enabled }),
    }),
  uninstallMod: (serverId: string, fullName: string) =>
    request<ServerModsState>(
      `/api/mods/server/${encodeURIComponent(serverId)}/${encodeURIComponent(fullName)}`,
      { method: 'DELETE' }
    ),
  uploadCustomMod: (serverId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ServerModsState>(`/api/mods/server/${encodeURIComponent(serverId)}/upload`, {
      method: 'POST',
      body: form,
    });
  },
  readModConfig: (serverId: string, filename: string) =>
    request<{ filename: string; content: string }>(
      `/api/mods/server/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(filename)}`
    ),
  saveModConfig: (serverId: string, filename: string, content: string) =>
    request<{ ok: boolean }>(
      `/api/mods/server/${encodeURIComponent(serverId)}/configs/${encodeURIComponent(filename)}`,
      { method: 'PUT', body: JSON.stringify({ content }) }
    ),
};
