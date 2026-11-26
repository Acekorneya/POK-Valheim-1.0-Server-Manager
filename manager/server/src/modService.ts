import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import archiver from 'archiver';
import type { Response } from 'express';
import { getServerConfigDir } from './config.js';
import { store } from './store.js';
import type { InstalledMod, ServerModsState, ThunderstoreModSummary } from './types.js';

const THUNDERSTORE_VALHEIM_API = 'https://thunderstore.io/c/valheim/api/v1/package/';
const BEPINEX_FULL_NAME = 'denikson-BepInExPack_Valheim';
const POK_QOL_FULL_NAME = 'POK-POKValheimQoL';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface ThunderstoreRawVersion {
  version_number: string;
  download_url: string;
  downloads: number;
  date_created: string;
  dependencies: string[];
  description: string;
  icon: string;
}

interface ThunderstoreRawPkg {
  uuid4: string;
  name: string;
  full_name: string;
  owner: string;
  package_url: string;
  date_updated: string;
  rating_score: number;
  is_deprecated: boolean;
  categories: string[];
  versions: ThunderstoreRawVersion[];
}

interface InstalledModsManifest {
  bepInExVersion: string | null;
  mods: InstalledMod[];
}

function getModsRootDir(serverId: string): string {
  return path.join(getServerConfigDir(serverId), 'mods');
}

function getManifestPath(serverId: string): string {
  return path.join(getModsRootDir(serverId), 'installed-mods.json');
}

function sanitizeModFolder(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-.]/g, '_');
}

class ModService {
  private catalogCache: ThunderstoreModSummary[] = [];
  private catalogFetchedAt = 0;
  private fetchingPromise: Promise<ThunderstoreModSummary[]> | null = null;

  async getCatalog(forceRefresh = false): Promise<ThunderstoreModSummary[]> {
    const now = Date.now();
    if (!forceRefresh && this.catalogCache.length > 0 && now - this.catalogFetchedAt < CACHE_TTL_MS) {
      return this.catalogCache;
    }

    if (this.fetchingPromise) {
      return this.fetchingPromise;
    }

    this.fetchingPromise = (async () => {
      try {
        const resp = await fetch(THUNDERSTORE_VALHEIM_API, {
          headers: { 'User-Agent': 'POK-Valheim-Manager/1.0' },
          signal: AbortSignal.timeout(30000),
        });
        if (!resp.ok) {
          throw new Error(`Thunderstore API returned HTTP ${resp.status}`);
        }
        const raw = (await resp.json()) as ThunderstoreRawPkg[];
        const summaries: ThunderstoreModSummary[] = [];
        for (const pkg of raw) {
          if (!pkg.versions || pkg.versions.length === 0) continue;
          const latest = pkg.versions[0];
          const totalDownloads = pkg.versions.reduce((sum, v) => sum + (v.downloads || 0), 0);
          summaries.push({
            uuid4: pkg.uuid4,
            name: pkg.name,
            fullName: pkg.full_name,
            owner: pkg.owner,
            description: latest.description || '',
            icon: latest.icon || '',
            packageUrl: pkg.package_url,
            categories: pkg.categories || [],
            totalDownloads,
            ratingScore: pkg.rating_score || 0,
            dateUpdated: pkg.date_updated || latest.date_created,
            latestVersion: latest.version_number,
            downloadUrl: latest.download_url,
            dependencies: latest.dependencies || [],
            isDeprecated: Boolean(pkg.is_deprecated),
          });
        }
        this.catalogCache = summaries;
        this.catalogFetchedAt = Date.now();
        return summaries;
      } finally {
        this.fetchingPromise = null;
      }
    })();

    return this.fetchingPromise;
  }

  async searchCatalog(opts: {
    search?: string;
    sort?: 'popular' | 'latest' | 'rating';
    category?: string;
    page?: number;
    limit?: number;
    includeDeprecated?: boolean;
    forceRefresh?: boolean;
  }): Promise<{
    total: number;
    page: number;
    limit: number;
    categories: string[];
    mods: ThunderstoreModSummary[];
  }> {
    const all = await this.getCatalog(opts.forceRefresh);
    const catSet = new Set<string>();
    for (const m of all) {
      if (!m.isDeprecated) {
        for (const c of m.categories) catSet.add(c);
      }
    }

    let filtered = all.filter((m) => opts.includeDeprecated || !m.isDeprecated);

    if (opts.category && opts.category !== 'all') {
      const catLower = opts.category.toLowerCase();
      filtered = filtered.filter((m) =>
        m.categories.some((c) => c.toLowerCase() === catLower)
      );
    }

    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim().toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.owner.toLowerCase().includes(q) ||
          m.fullName.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q)
      );
    }

    const sort = opts.sort || 'popular';
    filtered = [...filtered].sort((a, b) => {
      if (sort === 'latest') return b.dateUpdated.localeCompare(a.dateUpdated);
      if (sort === 'rating') return b.ratingScore - a.ratingScore || b.totalDownloads - a.totalDownloads;
      return b.totalDownloads - a.totalDownloads;
    });

    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(60, Math.max(1, opts.limit || 24));
    const start = (page - 1) * limit;

    return {
      total: filtered.length,
      page,
      limit,
      categories: Array.from(catSet).sort(),
      mods: filtered.slice(start, start + limit),
    };
  }

  private readManifest(serverId: string): InstalledModsManifest {
    const p = getManifestPath(serverId);
    if (!fs.existsSync(p)) {
      return { bepInExVersion: null, mods: [] };
    }
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as InstalledModsManifest;
    } catch {
      return { bepInExVersion: null, mods: [] };
    }
  }

  private writeManifest(serverId: string, manifest: InstalledModsManifest): void {
    const dir = getModsRootDir(serverId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getManifestPath(serverId), JSON.stringify(manifest, null, 2), 'utf-8');
  }

  getServerModsState(serverId: string): ServerModsState {
    const server = store.getServer(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const modsRoot = getModsRootDir(serverId);
    const manifest = this.readManifest(serverId);
    const bepInExCore = path.join(modsRoot, 'BepInEx', 'core', 'BepInEx.Preloader.dll');
    const bepInExInstalled = fs.existsSync(bepInExCore);

    const configDir = path.join(modsRoot, 'BepInEx', 'config');
    let configFiles: string[] = [];
    if (fs.existsSync(configDir)) {
      configFiles = fs
        .readdirSync(configDir)
        .filter((f) => f.endsWith('.cfg') || f.endsWith('.json') || f.endsWith('.yml') || f.endsWith('.yaml'))
        .sort();
    }

    return {
      serverId,
      modsEnabled: Boolean(server.modsEnabled),
      bepInExInstalled,
      bepInExVersion: manifest.bepInExVersion,
      mods: manifest.mods,
      configFiles,
    };
  }

  setServerModsEnabled(serverId: string, enabled: boolean): ServerModsState {
    const server = store.getServer(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);
    store.updateServer(serverId, {
      ...server,
      modsEnabled: enabled,
      updatedAt: new Date().toISOString(),
    });
    return this.getServerModsState(serverId);
  }

  private async downloadZipBuffer(url: string): Promise<Buffer> {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'POK-Valheim-Manager/1.0' },
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) {
      throw new Error(`Failed to download mod package (HTTP ${resp.status})`);
    }
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  }

  private extractBepInExPack(serverId: string, zipBuf: Buffer, version: string): void {
    const modsRoot = getModsRootDir(serverId);
    fs.mkdirSync(modsRoot, { recursive: true });
    const zip = new AdmZip(zipBuf);

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      let norm = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
      if (norm.includes('..')) continue;
      // Thunderstore BepInExPack_Valheim nests files under "BepInExPack_Valheim/"
      if (norm.startsWith('BepInExPack_Valheim/')) {
        norm = norm.slice('BepInExPack_Valheim/'.length);
      }
      if (!norm) continue;
      const outPath = path.join(modsRoot, norm);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }

    // Ensure plugins & config directories exist
    fs.mkdirSync(path.join(modsRoot, 'BepInEx', 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(modsRoot, 'BepInEx', 'plugins_disabled'), { recursive: true });
    fs.mkdirSync(path.join(modsRoot, 'BepInEx', 'config'), { recursive: true });

    const manifest = this.readManifest(serverId);
    manifest.bepInExVersion = version;
    this.writeManifest(serverId, manifest);
  }

  async installThunderstoreMod(
    serverId: string,
    fullName: string,
    installDependencies = true,
    visited = new Set<string>()
  ): Promise<ServerModsState> {
    if (visited.has(fullName)) return this.getServerModsState(serverId);
    visited.add(fullName);

    const server = store.getServer(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const catalog = await this.getCatalog();
    const pkg = catalog.find((m) => m.fullName.toLowerCase() === fullName.toLowerCase());
    if (!pkg) {
      throw new Error(`Mod "${fullName}" not found on Thunderstore`);
    }

    // Special case: BepInExPack_Valheim
    if (pkg.fullName.toLowerCase() === BEPINEX_FULL_NAME.toLowerCase()) {
      const zipBuf = await this.downloadZipBuffer(pkg.downloadUrl);
      this.extractBepInExPack(serverId, zipBuf, pkg.latestVersion);
      if (!server.modsEnabled) {
        this.setServerModsEnabled(serverId, true);
      }
      store.addActivity('server', `Installed BepInExPack_Valheim v${pkg.latestVersion} on "${server.name}"`);
      store.save();
      return this.getServerModsState(serverId);
    }

    // Ensure BepInEx is installed first
    const modsRoot = getModsRootDir(serverId);
    if (!fs.existsSync(path.join(modsRoot, 'BepInEx', 'core', 'BepInEx.Preloader.dll'))) {
      await this.installThunderstoreMod(serverId, BEPINEX_FULL_NAME, false, visited);
    }

    // Optionally install dependencies
    if (installDependencies && pkg.dependencies.length > 0) {
      for (const depStr of pkg.dependencies) {
        // Format: "Owner-ModName-1.2.3"
        const parts = depStr.split('-');
        if (parts.length >= 3) {
          const depFullName = `${parts[0]}-${parts[1]}`;
          if (depFullName.toLowerCase() === BEPINEX_FULL_NAME.toLowerCase()) continue;
          const manifest = this.readManifest(serverId);
          if (!manifest.mods.some((m) => m.fullName.toLowerCase() === depFullName.toLowerCase())) {
            try {
              await this.installThunderstoreMod(serverId, depFullName, true, visited);
            } catch (err) {
              console.warn(`[ModService] Failed to install dependency ${depFullName}:`, (err as Error).message);
            }
          }
        }
      }
    }

    const zipBuf = await this.downloadZipBuffer(pkg.downloadUrl);
    const zip = new AdmZip(zipBuf);
    const pluginDirName = sanitizeModFolder(pkg.fullName);
    const targetPluginDir = path.join(modsRoot, 'BepInEx', 'plugins', pluginDirName);
    const disabledPluginDir = path.join(modsRoot, 'BepInEx', 'plugins_disabled', pluginDirName);

    // Clean previous install of this mod
    if (fs.existsSync(targetPluginDir)) fs.rmSync(targetPluginDir, { recursive: true, force: true });
    if (fs.existsSync(disabledPluginDir)) fs.rmSync(disabledPluginDir, { recursive: true, force: true });
    fs.mkdirSync(targetPluginDir, { recursive: true });

    const ignoredMeta = new Set(['manifest.json', 'icon.png', 'readme.md', 'changelog.md', 'license', 'license.txt']);

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const norm = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
      if (norm.includes('..')) continue;
      const lower = norm.toLowerCase();

      if (lower.startsWith('bepinex/plugins/')) {
        const rel = norm.slice('bepinex/plugins/'.length);
        const out = path.join(targetPluginDir, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, entry.getData());
      } else if (lower.startsWith('plugins/')) {
        const rel = norm.slice('plugins/'.length);
        const out = path.join(targetPluginDir, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, entry.getData());
      } else if (lower.startsWith('bepinex/config/')) {
        const rel = norm.slice('bepinex/config/'.length);
        const out = path.join(modsRoot, 'BepInEx', 'config', rel);
        if (!fs.existsSync(out)) {
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, entry.getData());
        }
      } else if (lower.startsWith('bepinex/patchers/')) {
        const rel = norm.slice('bepinex/patchers/'.length);
        const out = path.join(modsRoot, 'BepInEx', 'patchers', pluginDirName, rel);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, entry.getData());
      } else if (!ignoredMeta.has(path.basename(lower))) {
        const out = path.join(targetPluginDir, norm);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, entry.getData());
      }
    }

    const manifest = this.readManifest(serverId);
    manifest.mods = manifest.mods.filter((m) => m.fullName.toLowerCase() !== pkg.fullName.toLowerCase());
    manifest.mods.unshift({
      fullName: pkg.fullName,
      name: pkg.name,
      owner: pkg.owner,
      version: pkg.latestVersion,
      icon: pkg.icon,
      description: pkg.description,
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'thunderstore',
      pluginDirName,
    });
    this.writeManifest(serverId, manifest);

    if (!server.modsEnabled) {
      this.setServerModsEnabled(serverId, true);
    }

    store.addActivity('server', `Installed mod "${pkg.name}" v${pkg.latestVersion} on "${server.name}"`);
    store.save();

    return this.getServerModsState(serverId);
  }

  toggleMod(serverId: string, fullName: string, enabled: boolean): ServerModsState {
    const manifest = this.readManifest(serverId);
    const mod = manifest.mods.find((m) => m.fullName === fullName);
    if (!mod) throw new Error(`Mod "${fullName}" is not installed`);

    const modsRoot = getModsRootDir(serverId);
    const activeDir = path.join(modsRoot, 'BepInEx', 'plugins', mod.pluginDirName);
    const disabledDir = path.join(modsRoot, 'BepInEx', 'plugins_disabled', mod.pluginDirName);

    fs.mkdirSync(path.join(modsRoot, 'BepInEx', 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(modsRoot, 'BepInEx', 'plugins_disabled'), { recursive: true });

    if (enabled && fs.existsSync(disabledDir)) {
      fs.renameSync(disabledDir, activeDir);
    } else if (!enabled && fs.existsSync(activeDir)) {
      fs.renameSync(activeDir, disabledDir);
    }

    mod.enabled = enabled;
    this.writeManifest(serverId, manifest);
    return this.getServerModsState(serverId);
  }

  uninstallMod(serverId: string, fullName: string): ServerModsState {
    const manifest = this.readManifest(serverId);
    const mod = manifest.mods.find((m) => m.fullName === fullName);
    if (!mod) throw new Error(`Mod "${fullName}" is not installed`);

    const modsRoot = getModsRootDir(serverId);
    for (const sub of ['plugins', 'plugins_disabled', 'patchers']) {
      const target = path.join(modsRoot, 'BepInEx', sub, mod.pluginDirName);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }

    manifest.mods = manifest.mods.filter((m) => m.fullName !== fullName);
    this.writeManifest(serverId, manifest);
    store.addActivity('server', `Removed mod "${mod.name}" from server ${serverId}`);
    store.save();
    return this.getServerModsState(serverId);
  }

  async uploadCustomMod(serverId: string, file: Express.Multer.File): Promise<ServerModsState> {
    const server = store.getServer(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const modsRoot = getModsRootDir(serverId);
    if (!fs.existsSync(path.join(modsRoot, 'BepInEx', 'core', 'BepInEx.Preloader.dll'))) {
      await this.installThunderstoreMod(serverId, BEPINEX_FULL_NAME, false);
    }

    const orig = path.basename(file.originalname);
    const ext = path.extname(orig).toLowerCase();
    const baseName = orig.slice(0, -ext.length) || 'CustomMod';
    const fullName = `custom-${sanitizeModFolder(baseName)}`;
    const targetDir = path.join(modsRoot, 'BepInEx', 'plugins', fullName);
    fs.mkdirSync(targetDir, { recursive: true });

    if (ext === '.zip') {
      const zip = new AdmZip(file.buffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const norm = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '');
        if (norm.includes('..')) continue;
        const out = path.join(targetDir, norm);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, entry.getData());
      }
    } else if (ext === '.dll') {
      fs.writeFileSync(path.join(targetDir, orig), file.buffer);
    } else {
      throw new Error('Only .zip or .dll mod files are supported');
    }

    const manifest = this.readManifest(serverId);
    manifest.mods = manifest.mods.filter((m) => m.fullName !== fullName);
    manifest.mods.unshift({
      fullName,
      name: baseName,
      owner: 'Custom Upload',
      version: 'custom',
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'custom',
      pluginDirName: fullName,
    });
    this.writeManifest(serverId, manifest);
    if (!server.modsEnabled) this.setServerModsEnabled(serverId, true);
    store.addActivity('server', `Uploaded custom mod "${baseName}" to "${server.name}"`);
    store.save();
    return this.getServerModsState(serverId);
  }

  readConfigFile(serverId: string, filename: string): string {
    const safe = path.basename(filename);
    const p = path.join(getModsRootDir(serverId), 'BepInEx', 'config', safe);
    if (!fs.existsSync(p)) throw new Error('Config file not found');
    return fs.readFileSync(p, 'utf-8');
  }

  writeConfigFile(serverId: string, filename: string, content: string): void {
    const safe = path.basename(filename);
    const dir = path.join(getModsRootDir(serverId), 'BepInEx', 'config');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safe), content, 'utf-8');
    store.addActivity('server', `Updated mod config "${safe}" for server ${serverId}`);
    store.save();
  }

  async installPokQoL(serverId: string): Promise<ServerModsState> {
    const server = store.getServer(serverId);
    if (!server) throw new Error(`Server not found: ${serverId}`);

    const dllSource = process.env.POK_QOL_DLL_PATH || '/app/pok-qol/POKValheimQoL.dll';
    if (!fs.existsSync(dllSource)) {
      throw new Error(`POKValheimQoL.dll not found at ${dllSource}`);
    }

    const modsRoot = getModsRootDir(serverId);
    if (!fs.existsSync(path.join(modsRoot, 'BepInEx', 'core', 'BepInEx.Preloader.dll'))) {
      await this.installThunderstoreMod(serverId, BEPINEX_FULL_NAME, false);
    }

    const targetDir = path.join(modsRoot, 'BepInEx', 'plugins', POK_QOL_FULL_NAME);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(dllSource, path.join(targetDir, 'POKValheimQoL.dll'));

    const manifest = this.readManifest(serverId);
    manifest.mods = manifest.mods.filter((m) => m.fullName !== POK_QOL_FULL_NAME);
    manifest.mods.unshift({
      fullName: POK_QOL_FULL_NAME,
      name: 'POK-Valheim QoL Pack',
      owner: 'POK-Valheim Built-In',
      version: '1.0.0',
      description:
        '[DROPOFF] Auto-Sort Drop-Off Chest, Alt+G Quick-Stack, and Craft & Build From Nearby Chests.',
      enabled: true,
      installedAt: new Date().toISOString(),
      source: 'custom',
      pluginDirName: POK_QOL_FULL_NAME,
    });
    this.writeManifest(serverId, manifest);

    if (!server.modsEnabled) {
      this.setServerModsEnabled(serverId, true);
    }

    store.addActivity('server', `Installed POK-Valheim QoL Pack on "${server.name}"`);
    store.save();
    return this.getServerModsState(serverId);
  }

  async streamClientModpackZip(serverId: string, res: Response): Promise<void> {
    const server = store.getServer(serverId);
    if (!server) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }

    const modsRoot = getModsRootDir(serverId);
    if (!fs.existsSync(path.join(modsRoot, 'BepInEx', 'core', 'BepInEx.Preloader.dll'))) {
      await this.installThunderstoreMod(serverId, BEPINEX_FULL_NAME, false);
    }

    const safeServer = server.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const zipName = `POK-${safeServer}-ClientMods.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    // 1. Add Windows BepInEx loader root files
    for (const rootFile of ['winhttp.dll', 'doorstop_config.ini', '.doorstop_version']) {
      const p = path.join(modsRoot, rootFile);
      if (fs.existsSync(p)) {
        archive.file(p, { name: `payload/${rootFile}` });
      }
    }

    // 2. Add BepInEx core & config
    const coreDir = path.join(modsRoot, 'BepInEx', 'core');
    if (fs.existsSync(coreDir)) {
      archive.directory(coreDir, 'payload/BepInEx/core');
    }
    const cfgDir = path.join(modsRoot, 'BepInEx', 'config');
    if (fs.existsSync(cfgDir)) {
      archive.directory(cfgDir, 'payload/BepInEx/config');
    }

    // 3. Add all ENABLED plugins (excluding server-only POKValheimBridge)
    const pluginsDir = path.join(modsRoot, 'BepInEx', 'plugins');
    if (fs.existsSync(pluginsDir)) {
      for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
        if (entry.name.toLowerCase().includes('pokvalheimbridge')) continue;
        const full = path.join(pluginsDir, entry.name);
        if (entry.isDirectory()) {
          archive.directory(full, `payload/BepInEx/plugins/${entry.name}`);
        } else if (entry.isFile()) {
          archive.file(full, { name: `payload/BepInEx/plugins/${entry.name}` });
        }
      }
    }

    const patchersDir = path.join(modsRoot, 'BepInEx', 'patchers');
    if (fs.existsSync(patchersDir)) {
      archive.directory(patchersDir, 'payload/BepInEx/patchers');
    }

    // 4. Add bulletproof 1-Click Windows Auto-Installer (Install-POK-Mods.bat -> install.ps1)
    const installPs1 = `$ErrorActionPreference = 'Stop'
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "  POK-Valheim 1-Click Mod Installer" -ForegroundColor Yellow
Write-Host "  Realm: ${server.name.replace(/"/g, "'")}" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

function Find-ValheimDir {
  $steamRoots = @()

  # 1. Read Steam install path from Windows Registry (HKCU + HKLM)
  foreach ($regPath in @(
    'HKCU:\\Software\\Valve\\Steam',
    'HKLM:\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
    'HKLM:\\SOFTWARE\\Valve\\Steam'
  )) {
    try {
      $props = Get-ItemProperty -Path $regPath -ErrorAction Stop
      foreach ($propName in @('SteamPath', 'InstallPath')) {
        $val = $props.$propName
        if ($val -and (Test-Path $val)) {
          $steamRoots += ($val -replace '/', '\\')
        }
      }
    } catch {}
  }

  # 2. Parse Steam's libraryfolders.vdf (finds ANY custom Steam library on ANY drive!)
  $allLibraries = @()
  foreach ($root in ($steamRoots | Select-Object -Unique)) {
    $allLibraries += $root
    $vdf = Join-Path $root 'steamapps\\libraryfolders.vdf'
    if (Test-Path $vdf) {
      Get-Content $vdf -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_ -match '"path"\\s+"([^"]+)"') {
          $libPath = $matches[1] -replace '\\\\\\\\', '\\'
          if (Test-Path $libPath) { $allLibraries += $libPath }
        }
      }
    }
  }

  # 3. Also scan common Steam library locations across all local drives
  foreach ($drv in (Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Z]:\\\\$' })) {
    foreach ($sub in @('Program Files (x86)\\Steam', 'Program Files\\Steam', 'Steam', 'SteamLibrary', 'Games\\Steam', 'Games\\SteamLibrary')) {
      $p = Join-Path $drv.Root $sub
      if (Test-Path $p) { $allLibraries += $p }
    }
  }

  foreach ($lib in ($allLibraries | Select-Object -Unique)) {
    $cand = Join-Path $lib 'steamapps\\common\\Valheim'
    if (Test-Path (Join-Path $cand 'valheim.exe')) {
      return $cand
    }
  }
  return $null
}

$valheimDir = Find-ValheimDir

if (-not $valheimDir) {
  Write-Host "Could not auto-detect your Valheim folder." -ForegroundColor Yellow
  $valheimDir = Read-Host "Paste your Valheim folder path (containing valheim.exe)"
  $valheimDir = $valheimDir.Trim('"').Trim()
}

if (-not $valheimDir -or -not (Test-Path (Join-Path $valheimDir 'valheim.exe'))) {
  Write-Host ""
  Write-Host "[ERROR] valheim.exe not found in: $valheimDir" -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "Found Valheim at: $valheimDir" -ForegroundColor Green
Write-Host "Installing BepInEx and realm mods..." -ForegroundColor Cyan

$payloadDir = Join-Path $PSScriptRoot 'payload'
Copy-Item -Path (Join-Path $payloadDir '*') -Destination $valheimDir -Recurse -Force

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  SUCCESS! Mods installed for '${server.name.replace(/'/g, '')}'!" -ForegroundColor Green
Write-Host "  Launch Valheim from Steam normally and join the server!" -ForegroundColor White
Write-Host "  (Run Uninstall-POK-Mods.bat anytime to return to vanilla)" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"
`.replace(/\n/g, '\r\n');

    const uninstallPs1 = `$ErrorActionPreference = 'Stop'
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "  POK-Valheim Mod Uninstaller (Return to 100% Vanilla)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host ""

$steamRoots = @('C:\\Program Files (x86)\\Steam')
try {
  $sp = (Get-ItemProperty -Path 'HKCU:\\Software\\Valve\\Steam' -ErrorAction Stop).SteamPath
  if ($sp) { $steamRoots += ($sp -replace '/', '\\') }
} catch {}

$libs = @()
foreach ($r in ($steamRoots | Select-Object -Unique)) {
  $libs += $r
  $vdf = Join-Path $r 'steamapps\\libraryfolders.vdf'
  if (Test-Path $vdf) {
    Get-Content $vdf -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_ -match '"path"\\s+"([^"]+)"') { $libs += ($matches[1] -replace '\\\\\\\\', '\\') }
    }
  }
}

$valheimDir = $null
foreach ($lib in ($libs | Select-Object -Unique)) {
  $cand = Join-Path $lib 'steamapps\\common\\Valheim'
  if (Test-Path (Join-Path $cand 'valheim.exe')) { $valheimDir = $cand; break }
}

if (-not $valheimDir) {
  $valheimDir = (Read-Host "Paste your Valheim folder path").Trim('"').Trim()
}

foreach ($item in @('BepInEx', 'winhttp.dll', 'doorstop_config.ini', '.doorstop_version')) {
  $p = Join-Path $valheimDir $item
  if (Test-Path $p) { Remove-Item -Path $p -Recurse -Force }
}

Write-Host ""
Write-Host "Done! Valheim at $valheimDir is back to 100% vanilla." -ForegroundColor Green
Read-Host "Press Enter to close"
`.replace(/\n/g, '\r\n');

    const installBat = `@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
`.replace(/\n/g, '\r\n');

    const uninstallBat = `@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
`.replace(/\n/g, '\r\n');

    const readmeTxt = `POK-Valheim Client Modpack for "${server.name}"
==================================================

HOW TO INSTALL (Takes 5 seconds):
1. Extract this entire .zip file to any folder.
2. Double-click "Install-POK-Mods.bat".
   (Automatically finds Valheim on ANY Steam drive/library!)
3. Launch Valheim from Steam normally and join the server!

HOW TO USE POK-Valheim QoL (if included):
- POK Drop-Off Chest: Craft a copper-tinted "POK Drop-Off Chest" in the Hammer
  (Furniture tab, 10 Fine Wood + 4 Copper). Dump your loot inside and close it —
  items automatically fly into nearby chests (within 20m) that already have that item!
- Quick-Stack Hotkey: Press Alt + G near your storage room to store matching items.
- Craft & Build From Chests: Just build or craft normally — materials pull automatically
  from nearby chests within 15m!

HOW TO UNINSTALL:
- Double-click "Uninstall-POK-Mods.bat" to return to 100% vanilla Valheim.
`.replace(/\n/g, '\r\n');

    archive.append(installBat, { name: 'Install-POK-Mods.bat' });
    archive.append(installPs1, { name: 'install.ps1' });
    archive.append(uninstallBat, { name: 'Uninstall-POK-Mods.bat' });
    archive.append(uninstallPs1, { name: 'uninstall.ps1' });
    archive.append(readmeTxt, { name: 'README-HOW-TO-INSTALL.txt' });

    await archive.finalize();
  }
}

export const modService = new ModService();
