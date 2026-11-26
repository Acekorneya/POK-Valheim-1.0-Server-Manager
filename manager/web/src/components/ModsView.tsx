import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Puzzle,
  Search,
  Download,
  RefreshCw,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Upload,
  FileCode2,
  Save,
  Sparkles,
  Power,
  ChevronLeft,
  ChevronRight,
  Info,
  PackageCheck,
  Share2,
} from 'lucide-react';
import { api, copyToClipboard } from '../api';
import type { ServerModsState, ServerWithStatus, ThunderstoreModSummary } from '../types';

interface ModsViewProps {
  servers: ServerWithStatus[];
  onNotify: (msg: string, isError?: boolean) => void;
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ModsView({ servers, onNotify }: ModsViewProps) {
  const [selectedServerId, setSelectedServerId] = useState(servers[0]?.id || '');
  const [subTab, setSubTab] = useState<'browse' | 'installed' | 'configs'>('browse');

  // Server mods state
  const [serverMods, setServerMods] = useState<ServerModsState | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  // Thunderstore catalog state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<'popular' | 'latest' | 'rating'>('popular');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [catalogMods, setCatalogMods] = useState<ThunderstoreModSummary[]>([]);

  // Config editor state
  const [activeConfig, setActiveConfig] = useState<string | null>(null);
  const [configContent, setConfigContent] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selectedServerId && servers[0]?.id) {
      setSelectedServerId(servers[0].id);
    }
  }, [servers, selectedServerId]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadServerMods = useCallback(async () => {
    if (!selectedServerId) return;
    try {
      const state = await api.getServerMods(selectedServerId);
      setServerMods(state);
    } catch (err) {
      console.error(err);
    }
  }, [selectedServerId]);

  const loadCatalog = useCallback(
    async (forceRefresh = false) => {
      setCatalogLoading(true);
      try {
        const res = await api.searchModsCatalog({
          search: debouncedSearch,
          sort,
          category,
          page,
          limit: 18,
          refresh: forceRefresh,
        });
        setCatalogMods(res.mods);
        setCatalogTotal(res.total);
        setCategories(res.categories);
      } catch (err) {
        onNotify(`Failed to load Thunderstore catalog: ${(err as Error).message}`, true);
      } finally {
        setCatalogLoading(false);
      }
    },
    [debouncedSearch, sort, category, page, onNotify]
  );

  useEffect(() => {
    loadServerMods();
  }, [loadServerMods]);

  useEffect(() => {
    loadCatalog(false);
  }, [loadCatalog]);

  const handleInstall = async (fullName: string, displayName: string) => {
    if (!selectedServerId) return;
    setInstallingId(fullName);
    try {
      const updated = await api.installMod(selectedServerId, fullName, true);
      setServerMods(updated);
      onNotify(`Installed "${displayName}" (+ dependencies). Restart the realm when ready to activate.`);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setInstallingId(null);
    }
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    if (!selectedServerId) return;
    try {
      const updated = await api.setServerModsEnabled(selectedServerId, enabled);
      setServerMods(updated);
      onNotify(
        enabled
          ? 'BepInEx mod loader enabled for this realm (applies on next container recreate/restart).'
          : 'BepInEx mod loader disabled for this realm (applies on next restart).'
      );
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleToggleMod = async (fullName: string, enabled: boolean) => {
    if (!selectedServerId) return;
    try {
      const updated = await api.toggleMod(selectedServerId, fullName, enabled);
      setServerMods(updated);
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleUninstall = async (fullName: string, name: string) => {
    if (!selectedServerId) return;
    if (!confirm(`Uninstall "${name}" from this server?`)) return;
    try {
      const updated = await api.uninstallMod(selectedServerId, fullName);
      setServerMods(updated);
      onNotify(`Removed "${name}"`);
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleUploadCustom = async (files: FileList | null) => {
    if (!selectedServerId || !files || files.length === 0) return;
    setInstallingId('__upload__');
    try {
      const updated = await api.uploadCustomMod(selectedServerId, files[0]);
      setServerMods(updated);
      onNotify(`Uploaded custom mod "${files[0].name}"!`);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setInstallingId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openConfigFile = async (filename: string) => {
    if (!selectedServerId) return;
    try {
      const res = await api.readModConfig(selectedServerId, filename);
      setActiveConfig(filename);
      setConfigContent(res.content);
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedServerId || !activeConfig) return;
    setSavingConfig(true);
    try {
      await api.saveModConfig(selectedServerId, activeConfig, configContent);
      onNotify(`Saved ${activeConfig}!`);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleInstallPokQoL = async () => {
    if (!selectedServerId) return;
    setInstallingId('POK-POKValheimQoL');
    try {
      const updated = await api.installPokQoL(selectedServerId);
      setServerMods(updated);
      onNotify(
        'Installed POK-Valheim QoL Pack! Download & share the 1-Click Player Installer so friends get it too.'
      );
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setInstallingId(null);
    }
  };

  const handleCopyShareLink = async () => {
    if (!selectedServerId) return;
    const url = `${window.location.origin}${api.getClientModpackUrl(selectedServerId)}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      onNotify('Copied 1-Click Player Modpack link! Paste it in Discord for your friends.');
    } else {
      window.prompt('Copy this Player Modpack link:', url);
    }
  };

  const installedMap = new Map(
    (serverMods?.mods || []).map((m) => [m.fullName.toLowerCase(), m])
  );
  const pokQolInstalled = installedMap.has('pok-pokvalheimqol');
  const totalPages = Math.max(1, Math.ceil(catalogTotal / 18));

  return (
    <div className="space-y-5">
      {/* Top Server Selector & BepInEx Status Bar */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Puzzle className="w-5 h-5 text-amber-400" />
              <span className="text-sm font-semibold text-slate-100">Target Realm:</span>
            </div>
            <select
              value={selectedServerId}
              onChange={(e) => {
                setSelectedServerId(e.target.value);
                setActiveConfig(null);
              }}
              disabled={servers.length === 0}
              className="rounded-xl bg-[#0b0f18] border border-slate-700 px-3.5 py-2 text-xs text-slate-100 font-medium"
            >
              {servers.length === 0 && <option value="">No realms created yet</option>}
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (World: {s.worldName})
                </option>
              ))}
            </select>

            {serverMods && (
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
                  serverMods.bepInExInstalled
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {serverMods.bepInExInstalled
                  ? `BepInEx ${serverMods.bepInExVersion || 'Ready'}`
                  : 'BepInEx Not Installed (Auto-installs with any mod)'}
              </span>
            )}
          </div>

          {serverMods && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl bg-[#0b0f18] border border-slate-800 px-3 py-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={serverMods.modsEnabled}
                  onChange={(e) => handleToggleEnabled(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Enable BepInEx Mod Loader</span>
              </label>

              <div className="flex rounded-xl bg-[#0b0f18] p-1 border border-slate-800">
                {(
                  [
                    { id: 'browse', label: 'Browse Thunderstore' },
                    { id: 'installed', label: `Installed (${serverMods.mods.length})` },
                    { id: 'configs', label: `Configs (${serverMods.configFiles.length})` },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSubTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                      subTab === t.id
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-[#0b0f18] border border-slate-800/70 rounded-xl px-3.5 py-2">
          <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>
            Each realm has its own isolated BepInEx plugins & config folder. Installing or editing
            mods never interrupts a running server — apply changes whenever you’re ready by
            clicking <strong>Save &amp; Apply</strong> or restarting the realm.
          </span>
        </div>
      </div>

      {/* POK-Valheim Built-In QoL & 1-Click Player Modpack Sharing */}
      {selectedServerId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-amber-500/10 via-[#111622] to-[#111622] border border-amber-500/30 p-5 flex flex-col justify-between gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-amber-200 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  POK-Valheim Built-In QoL Mod
                </h3>
                {pokQolInstalled && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold text-emerald-300">
                    Installed
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                Our custom balanced Valheim QoL mod: craft a copper-tinted{' '}
                <strong className="text-amber-200">POK Drop-Off Chest</strong> in the Hammer
                (Furniture tab — <code className="text-amber-300">10 Fine Wood + 4 Copper</code>) to
                auto-sort loot into nearby matching chests, press{' '}
                <code className="text-amber-300">Alt + G</code> to quick-stack, and craft/build from
                nearby chests!
              </p>
            </div>
            <div>
              <button
                onClick={handleInstallPokQoL}
                disabled={Boolean(installingId)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-xs cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {installingId === 'POK-POKValheimQoL'
                  ? 'Installing...'
                  : pokQolInstalled
                    ? 'Reinstall / Update POK-QoL'
                    : 'Install POK-Valheim QoL Pack'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-sky-500/10 via-[#111622] to-[#111622] border border-sky-500/30 p-5 flex flex-col justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-sky-200 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-sky-400" />
                1-Click Player Modpack Installer
              </h3>
              <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                Bundles BepInEx + every enabled mod &amp; config on this realm (including POK-QoL
                and any Thunderstore mods) with a Windows{' '}
                <code className="text-sky-300">Install-POK-Mods.bat</code> auto-installer so friends
                just unzip, double-click, and launch Valheim from Steam!
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={api.getClientModpackUrl(selectedServerId)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs"
              >
                <Download className="w-3.5 h-3.5" /> Download Player Installer (.zip)
              </a>
              <button
                onClick={handleCopyShareLink}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs cursor-pointer"
              >
                <Share2 className="w-3.5 h-3.5 text-sky-400" /> Copy Link for Friends
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 1: BROWSE THUNDERSTORE */}
      {subTab === 'browse' && (
        <div className="space-y-4">
          {/* Search & Sort Controls */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search Valheim mods on Thunderstore (e.g. Jotunn, EpicLoot, ValheimPlus, PlantEverything)..."
                className="w-full rounded-xl bg-[#111622] border border-slate-700/80 pl-10 pr-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as 'popular' | 'latest' | 'rating');
                  setPage(1);
                }}
                className="rounded-xl bg-[#111622] border border-slate-700/80 px-3 py-2.5 text-xs text-slate-200"
              >
                <option value="popular">Most Popular (Downloads)</option>
                <option value="latest">Latest Updated</option>
                <option value="rating">Highest Rated</option>
              </select>

              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setPage(1);
                }}
                className="rounded-xl bg-[#111622] border border-slate-700/80 px-3 py-2.5 text-xs text-slate-200 max-w-[180px]"
              >
                <option value="all">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <button
                onClick={() => loadCatalog(true)}
                disabled={catalogLoading}
                className="p-2.5 rounded-xl bg-[#111622] hover:bg-slate-800 border border-slate-700/80 text-slate-300 cursor-pointer"
                title="Refresh Thunderstore catalog"
              >
                <RefreshCw className={`w-4 h-4 ${catalogLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Results Grid */}
          {catalogLoading && catalogMods.length === 0 ? (
            <div className="rounded-2xl bg-[#111622]/80 border border-slate-800 p-12 text-center text-sm text-slate-400">
              Loading Valheim mods catalog from Thunderstore...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {catalogMods.map((mod) => {
                  const installed = installedMap.get(mod.fullName.toLowerCase());
                  const isBepInEx =
                    mod.fullName.toLowerCase() === 'denikson-bepinexpack_valheim';
                  const hasUpdate = installed && installed.version !== mod.latestVersion;
                  const isInstalling = installingId === mod.fullName;

                  return (
                    <div
                      key={mod.uuid4}
                      className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 hover:border-amber-500/35 transition p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        {mod.icon ? (
                          <img
                            src={mod.icon}
                            alt={mod.name}
                            className="w-12 h-12 rounded-xl object-cover bg-slate-900 border border-slate-800 shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                            <Puzzle className="w-5 h-5 text-amber-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="text-sm font-semibold text-slate-100 truncate">
                              {mod.name.replace(/_/g, ' ')}
                            </h4>
                            <a
                              href={mod.packageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-500 hover:text-amber-300 shrink-0"
                              title="View on Thunderstore"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                            <span>by {mod.owner}</span>
                            <span>•</span>
                            <span className="font-mono-code text-amber-300/90">
                              v{mod.latestVersion}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1.5 line-clamp-2 leading-relaxed">
                            {mod.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800/70">
                        <div className="flex items-center gap-3 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Download className="w-3 h-3 text-sky-400" />
                            {formatDownloads(mod.totalDownloads)}
                          </span>
                          <span>
                            {new Date(mod.dateUpdated).toLocaleDateString()}
                          </span>
                        </div>

                        {installed && !hasUpdate ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Installed
                          </span>
                        ) : isBepInEx && serverMods?.bepInExInstalled ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Core Ready
                          </span>
                        ) : (
                          <button
                            onClick={() => handleInstall(mod.fullName, mod.name)}
                            disabled={!selectedServerId || Boolean(installingId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold transition cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            {isInstalling
                              ? 'Installing...'
                              : hasUpdate
                                ? `Update to v${mod.latestVersion}`
                                : 'Install'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-2 text-xs text-slate-400">
                <span>
                  Showing page {page} of {totalPages} ({catalogTotal.toLocaleString()} Valheim mods)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#111622] border border-slate-800 hover:bg-slate-800 disabled:opacity-40 text-slate-200 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#111622] border border-slate-800 hover:bg-slate-800 disabled:opacity-40 text-slate-200 cursor-pointer"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* SUBTAB 2: INSTALLED MODS */}
      {subTab === 'installed' && serverMods && (
        <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-100">
              Installed Mods ({serverMods.mods.length})
            </h3>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.dll"
                className="hidden"
                onChange={(e) => handleUploadCustom(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={installingId === '__upload__'}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-amber-400" />
                {installingId === '__upload__' ? 'Uploading...' : 'Upload Custom .zip / .dll'}
              </button>
            </div>
          </div>

          {serverMods.mods.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-400">
              No mods installed on this realm yet. Browse Thunderstore to install popular mods in
              one click!
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70">
              {serverMods.mods.map((m) => (
                <div
                  key={m.fullName}
                  className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-800/20"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {m.icon ? (
                      <img
                        src={m.icon}
                        alt={m.name}
                        className="w-9 h-9 rounded-lg object-cover border border-slate-800"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                        <Puzzle className="w-4 h-4 text-amber-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-100 truncate">
                          {m.name.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[11px] font-mono-code text-amber-300">
                          v{m.version}
                        </span>
                        {!m.enabled && (
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400">
                            Disabled
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate">{m.owner}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleMod(m.fullName, !m.enabled)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                        m.enabled
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button
                      onClick={() => handleUninstall(m.fullName, m.name)}
                      className="p-2 rounded-lg hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 cursor-pointer"
                      title="Uninstall mod"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 3: MOD CONFIG EDITOR */}
      {subTab === 'configs' && serverMods && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-amber-400" />
              BepInEx Config Files ({serverMods.configFiles.length})
            </div>
            <div className="divide-y divide-slate-800/60 max-h-[500px] overflow-y-auto">
              {serverMods.configFiles.length === 0 ? (
                <div className="p-6 text-xs text-slate-400">
                  No `.cfg` files yet. Mods generate their config files automatically the first time
                  the server boots with BepInEx enabled.
                </div>
              ) : (
                serverMods.configFiles.map((f) => (
                  <button
                    key={f}
                    onClick={() => openConfigFile(f)}
                    className={`w-full text-left px-4 py-2.5 text-xs font-mono-code transition cursor-pointer ${
                      activeConfig === f
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'text-slate-300 hover:bg-slate-800/40'
                    }`}
                  >
                    {f}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl bg-[#111622]/90 border border-slate-800/80 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-xs font-mono-code text-slate-200">
                {activeConfig || 'Select a config file to edit'}
              </span>
              {activeConfig && (
                <button
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingConfig ? 'Saving...' : 'Save Config'}
                </button>
              )}
            </div>
            <textarea
              value={configContent}
              onChange={(e) => setConfigContent(e.target.value)}
              disabled={!activeConfig}
              placeholder="Select a .cfg file on the left to view and edit mod settings..."
              className="flex-1 min-h-[420px] bg-[#07090e] p-4 font-mono-code text-xs text-slate-200 focus:outline-none resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
