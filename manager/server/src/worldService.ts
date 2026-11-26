import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import type { Response } from 'express';
import { getServerConfigDir, getServerWorldsDir, getVaultDir } from './config.js';
import { store } from './store.js';
import type { PlayerLists, WorldSaveInfo } from './types.js';

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
}

function getTargetWorldsDir(location: string): string {
  if (location === 'vault') {
    const dir = getVaultDir();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const server = store.getServer(location);
  if (!server) {
    throw new Error(`Unknown server location: ${location}`);
  }
  const dir = getServerWorldsDir(server.id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function read7BitString(buf: Buffer, offset: number): { value: string; nextOffset: number } | null {
  let length = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    length |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) return null;
  }
  if (length < 0 || pos + length > buf.length) return null;
  return {
    value: buf.subarray(pos, pos + length).toString('utf-8'),
    nextOffset: pos + length,
  };
}

function parseSeedFromFwlFile(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    if (data.length < 16) return null;
    // Valheim FWL/FWL2 header: int32 byteLen, int32 version, string worldName, string seedName
    const nameRes = read7BitString(data, 8);
    if (!nameRes) return null;
    const seedRes = read7BitString(data, nameRes.nextOffset);
    if (!seedRes) return null;
    const seed = seedRes.value.trim();
    if (!seed || seed.length > 64 || /[\x00-\x1f]/.test(seed)) return null;
    return seed;
  } catch {
    return null;
  }
}

function extractWorldSeed(dir: string, worldName: string, isFolder: boolean): string | null {
  if (isFolder) {
    const folderPath = path.join(dir, worldName);
    if (!fs.existsSync(folderPath)) return null;
    try {
      const fwlFiles = fs
        .readdirSync(folderPath)
        .filter((f) => f.endsWith('.fwl2') || f.endsWith('.fwl'))
        .map((f) => ({
          full: path.join(folderPath, f),
          mtimeMs: fs.statSync(path.join(folderPath, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const f of fwlFiles) {
        const seed = parseSeedFromFwlFile(f.full);
        if (seed) return seed;
      }
    } catch {
      return null;
    }
    return null;
  }
  return parseSeedFromFwlFile(path.join(dir, `${worldName}.fwl`));
}

function getDirStatsRecursive(dirPath: string): {
  totalSize: number;
  latestMtimeMs: number;
  hasDb: boolean;
  hasFwl: boolean;
  fileCount: number;
} {
  let totalSize = 0;
  let latestMtimeMs = 0;
  let hasDb = false;
  let hasFwl = false;
  let fileCount = 0;

  const walk = (p: string) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const st = fs.statSync(full);
        totalSize += st.size;
        fileCount += 1;
        if (st.mtimeMs > latestMtimeMs) latestMtimeMs = st.mtimeMs;
        const lower = entry.name.toLowerCase();
        if (lower.endsWith('.db') || lower.endsWith('.db2')) hasDb = true;
        if (lower.endsWith('.fwl')) hasFwl = true;
      }
    }
  };

  walk(dirPath);
  if (latestMtimeMs === 0) {
    latestMtimeMs = fs.statSync(dirPath).mtimeMs;
  }
  return { totalSize, latestMtimeMs, hasDb, hasFwl, fileCount };
}

function scanWorldsInDir(
  dir: string,
  location: string,
  locationLabel: string,
  activeWorldName?: string
): WorldSaveInfo[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const worldsMap = new Map<
    string,
    { hasDb: boolean; hasFwl: boolean; size: number; mtimeMs: number; isFolder: boolean }
  >();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Valheim 1.0+ folder-based world format: worlds_local/<WorldName>/
      const folderPath = path.join(dir, entry.name);
      const stats = getDirStatsRecursive(folderPath);
      worldsMap.set(entry.name, {
        hasDb: stats.hasDb || stats.fileCount > 0,
        hasFwl: stats.hasFwl,
        size: stats.totalSize,
        mtimeMs: stats.latestMtimeMs,
        isFolder: true,
      });
      continue;
    }

    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== '.db' && ext !== '.fwl') continue;
    if (entry.name.includes('_backup_auto-')) continue;

    const base = entry.name.slice(0, -ext.length);
    const stat = fs.statSync(path.join(dir, entry.name));
    const current = worldsMap.get(base) ?? {
      hasDb: false,
      hasFwl: false,
      size: 0,
      mtimeMs: 0,
      isFolder: false,
    };
    if (ext === '.db') current.hasDb = true;
    if (ext === '.fwl') current.hasFwl = true;
    current.size += stat.size;
    if (stat.mtimeMs > current.mtimeMs) current.mtimeMs = stat.mtimeMs;
    worldsMap.set(base, current);
  }

  return Array.from(worldsMap.entries())
    .map(([name, info]) => ({
      name,
      location,
      locationLabel,
      hasDb: info.hasDb,
      hasFwl: info.hasFwl,
      isFolder: info.isFolder,
      seed: extractWorldSeed(dir, name, info.isFolder),
      totalSizeBytes: info.size,
      lastModified: new Date(info.mtimeMs).toISOString(),
      isActiveOnServer: activeWorldName ? activeWorldName === name : false,
    }))
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

export const worldService = {
  getWorldSeed(serverId: string, worldName: string): string | null {
    const dir = getServerWorldsDir(serverId);
    const folderPath = path.join(dir, worldName);
    const isFolder = fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory();
    return extractWorldSeed(dir, worldName, isFolder);
  },

  listAllWorlds(): WorldSaveInfo[] {
    const results: WorldSaveInfo[] = [];

    // Central World Vault
    results.push(...scanWorldsInDir(getVaultDir(), 'vault', 'World Vault (Shared Library)'));

    // Per-server worlds
    for (const server of store.getServers()) {
      const dir = getServerWorldsDir(server.id);
      results.push(...scanWorldsInDir(dir, server.id, server.name, server.worldName));
    }

    return results;
  },

  cloneWorld(
    sourceLocation: string,
    worldName: string,
    targetLocation: string,
    newWorldName?: string
  ): void {
    const safeSourceName = sanitizeName(worldName);
    const safeTargetName = sanitizeName(newWorldName || worldName);
    if (!safeSourceName || !safeTargetName) {
      throw new Error('Invalid world name');
    }

    const srcDir = getTargetWorldsDir(sourceLocation);
    const dstDir = getTargetWorldsDir(targetLocation);

    const srcFolder = path.join(srcDir, safeSourceName);
    const srcDb = path.join(srcDir, `${safeSourceName}.db`);
    const srcFwl = path.join(srcDir, `${safeSourceName}.fwl`);

    const hasFolder = fs.existsSync(srcFolder) && fs.statSync(srcFolder).isDirectory();
    const hasFlat = fs.existsSync(srcDb) || fs.existsSync(srcFwl);

    if (!hasFolder && !hasFlat) {
      throw new Error(`World "${safeSourceName}" not found in ${sourceLocation}`);
    }

    if (hasFolder) {
      const dstFolder = path.join(dstDir, safeTargetName);
      fs.cpSync(srcFolder, dstFolder, { recursive: true, force: true });
    }
    if (fs.existsSync(srcDb)) {
      fs.copyFileSync(srcDb, path.join(dstDir, `${safeTargetName}.db`));
    }
    if (fs.existsSync(srcFwl)) {
      fs.copyFileSync(srcFwl, path.join(dstDir, `${safeTargetName}.fwl`));
    }

    store.addActivity(
      'world',
      `Copied world "${safeSourceName}" (${sourceLocation}) → "${safeTargetName}" (${targetLocation})`
    );
    store.save();
  },

  deleteWorld(location: string, worldName: string): void {
    const safeName = sanitizeName(worldName);
    if (!safeName) throw new Error('Invalid world name');
    const dir = getTargetWorldsDir(location);

    const folderPath = path.join(dir, safeName);
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      fs.rmSync(folderPath, { recursive: true, force: true });
    }

    for (const ext of ['.db', '.fwl', '.db.old', '.fwl.old']) {
      const p = path.join(dir, `${safeName}${ext}`);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }

    store.addActivity('world', `Deleted world "${safeName}" from ${location}`);
    store.save();
  },

  handleUploadedFiles(location: string, files: Express.Multer.File[]): string[] {
    const dir = getTargetWorldsDir(location);
    const savedNames = new Set<string>();

    for (const file of files) {
      const origName = path.basename(file.originalname);
      const ext = path.extname(origName).toLowerCase();

      if (ext === '.zip') {
        const zip = new AdmZip(file.buffer);
        const entries = zip.getEntries();
        const hasDb2 = entries.some((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.db2'));

        if (hasDb2) {
          // Valheim 1.0 folder-based save zip
          const fallbackFolder = sanitizeName(origName.slice(0, -4)) || 'ImportedWorld';
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const norm = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
            if (norm.includes('..')) continue;
            const parts = norm.split('/').filter(Boolean);
            const targetRel = parts.length > 1 ? norm : `${fallbackFolder}/${parts[0]}`;
            const topFolder = sanitizeName(targetRel.split('/')[0]);
            const outPath = path.join(dir, targetRel);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, entry.getData());
            if (topFolder) savedNames.add(topFolder);
          }
        } else {
          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const entryName = path.basename(entry.entryName);
            const entryExt = path.extname(entryName).toLowerCase();
            if (entryExt === '.db' || entryExt === '.fwl') {
              const safe = sanitizeName(entryName);
              fs.writeFileSync(path.join(dir, safe), entry.getData());
              savedNames.add(safe.slice(0, -entryExt.length));
            }
          }
        }
      } else if (ext === '.db' || ext === '.fwl') {
        const safe = sanitizeName(origName);
        fs.writeFileSync(path.join(dir, safe), file.buffer);
        savedNames.add(safe.slice(0, -ext.length));
      }
    }

    const list = Array.from(savedNames);
    if (list.length > 0) {
      store.addActivity('world', `Uploaded world save(s) [${list.join(', ')}] to ${location}`);
      store.save();
    }
    return list;
  },

  streamWorldZip(location: string, worldName: string, res: Response): void {
    const safeName = sanitizeName(worldName);
    const dir = getTargetWorldsDir(location);
    const folderPath = path.join(dir, safeName);
    const dbPath = path.join(dir, `${safeName}.db`);
    const fwlPath = path.join(dir, `${safeName}.fwl`);

    const hasFolder = fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory();
    const hasFlat = fs.existsSync(dbPath) || fs.existsSync(fwlPath);

    if (!hasFolder && !hasFlat) {
      res.status(404).json({ error: 'World files not found' });
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    if (hasFolder) archive.directory(folderPath, safeName);
    if (fs.existsSync(dbPath)) archive.file(dbPath, { name: `${safeName}.db` });
    if (fs.existsSync(fwlPath)) archive.file(fwlPath, { name: `${safeName}.fwl` });
    archive.finalize();
  },

  getPlayerLists(serverId: string): PlayerLists {
    const dir = getServerConfigDir(serverId);
    fs.mkdirSync(dir, { recursive: true });
    const readOrEmpty = (file: string) => {
      const p = path.join(dir, file);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
    };
    return {
      adminlist: readOrEmpty('adminlist.txt'),
      bannedlist: readOrEmpty('bannedlist.txt'),
      permittedlist: readOrEmpty('permittedlist.txt'),
    };
  },

  savePlayerLists(serverId: string, lists: Partial<PlayerLists>): PlayerLists {
    const dir = getServerConfigDir(serverId);
    fs.mkdirSync(dir, { recursive: true });
    if (typeof lists.adminlist === 'string') {
      fs.writeFileSync(path.join(dir, 'adminlist.txt'), lists.adminlist, 'utf-8');
    }
    if (typeof lists.bannedlist === 'string') {
      fs.writeFileSync(path.join(dir, 'bannedlist.txt'), lists.bannedlist, 'utf-8');
    }
    if (typeof lists.permittedlist === 'string') {
      fs.writeFileSync(path.join(dir, 'permittedlist.txt'), lists.permittedlist, 'utf-8');
    }
    store.addActivity('server', `Updated player access lists for server ${serverId}`);
    store.save();
    return this.getPlayerLists(serverId);
  },
};
