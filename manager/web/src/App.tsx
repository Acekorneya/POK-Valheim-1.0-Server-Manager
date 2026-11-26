import { useCallback, useEffect, useState } from 'react';
import {
  Flame,
  Server,
  Globe,
  Archive,
  DownloadCloud,
  Puzzle,
  Plus,
  LogOut,
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { api, setToken } from './api';
import type {
  ActivityEntry,
  AuthStatus,
  BackupEntry,
  BackupPolicy,
  ServerConfig,
  ServerWithStatus,
  UpdatePolicy,
  WorldSaveInfo,
} from './types';
import { LoginScreen } from './components/LoginScreen';
import { ServerCard } from './components/ServerCard';
import { ServerModal } from './components/ServerModal';
import { ConsoleModal } from './components/ConsoleModal';
import { WorldsView } from './components/WorldsView';
import { BackupsView } from './components/BackupsView';
import { UpdatesView } from './components/UpdatesView';
import { ModsView } from './components/ModsView';

type Tab = 'servers' | 'worlds' | 'mods' | 'backups' | 'updates';

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [tab, setTab] = useState<Tab>('servers');

  const [dockerAvailable, setDockerAvailable] = useState(true);
  const [nextAvailablePort, setNextAvailablePort] = useState(2456);
  const [servers, setServers] = useState<ServerWithStatus[]>([]);
  const [worlds, setWorlds] = useState<WorldSaveInfo[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupPolicy, setBackupPolicy] = useState<BackupPolicy | null>(null);
  const [updatePolicy, setUpdatePolicy] = useState<UpdatePolicy | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const [busyServerIds, setBusyServerIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerConfig | null>(null);
  const [consoleServer, setConsoleServer] = useState<ServerWithStatus | null>(null);
  const [toast, setToast] = useState<{ msg: string; isError?: boolean } | null>(null);

  const notify = useCallback((msg: string, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadAuth = useCallback(async () => {
    try {
      const status = await api.getAuthStatus();
      setAuth(status);
    } catch {
      setAuth({
        authEnabled: true,
        authenticated: false,
        username: null,
        isDefaultPassword: false,
        publicHost: '',
      });
    }
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const [srvRes, worldRes, bkpRes, updRes, actRes] = await Promise.all([
        api.listServers(),
        api.listWorlds(),
        api.listBackups(),
        api.getUpdateStatus(),
        api.getActivity(),
      ]);
      setDockerAvailable(srvRes.dockerAvailable);
      setNextAvailablePort(srvRes.nextAvailablePort);
      setServers(srvRes.servers);
      setWorlds(worldRes.worlds);
      setBackups(bkpRes.backups);
      setBackupPolicy(bkpRes.policy);
      setUpdatePolicy(updRes);
      setActivity(actRes.activity);
    } catch (err) {
      console.error('Refresh error:', err);
    }
  }, []);

  useEffect(() => {
    loadAuth();
  }, [loadAuth]);

  useEffect(() => {
    if (!auth?.authenticated) return;
    refreshAll();
    const timer = setInterval(refreshAll, 6000);
    return () => clearInterval(timer);
  }, [auth?.authenticated, refreshAll]);

  const withServerBusy = async (id: string, fn: () => Promise<void>) => {
    setBusyServerIds((prev) => new Set(prev).add(id));
    try {
      await fn();
      await refreshAll();
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      setBusyServerIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  if (!auth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
        Connecting to POK-Valheim...
      </div>
    );
  }

  if (auth.authEnabled && !auth.authenticated) {
    return <LoginScreen onSuccess={loadAuth} />;
  }

  const runningCount = servers.filter((s) => s.runtime.state === 'running').length;
  const totalRamGb = (
    servers.reduce((acc, s) => acc + (s.runtime.state === 'running' ? s.runtime.memoryMb : 0), 0) /
    1024
  ).toFixed(2);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0b0f18]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/25 border border-amber-500/40 flex items-center justify-center">
              <Flame className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="font-nordic text-base font-bold tracking-wider text-amber-100 leading-none">
                POK-VALHEIM
              </h1>
              <p className="text-[11px] text-slate-400 mt-0.5">Multi-Realm Docker Manager</p>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav className="hidden md:flex items-center gap-1 rounded-xl bg-[#111622] p-1 border border-slate-800">
            {(
              [
                { id: 'servers', label: 'Realms', icon: Server, badge: servers.length },
                { id: 'worlds', label: 'Worlds & Saves', icon: Globe, badge: worlds.length },
                { id: 'mods', label: 'Mods', icon: Puzzle },
                { id: 'backups', label: 'Backups', icon: Archive, badge: backups.length },
                {
                  id: 'updates',
                  label: 'Updates',
                  icon: DownloadCloud,
                  dot: updatePolicy?.updateAvailable,
                },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
                    active
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{item.label}</span>
                  {'badge' in item && (
                    <span className="px-1.5 py-0.2 rounded bg-slate-800/90 text-[10px] text-slate-300">
                      {item.badge}
                    </span>
                  )}
                  {'dot' in item && item.dot && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshAll}
              className="p-2 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setEditingServer(null);
                setShowCreateModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-semibold text-xs transition shadow-md shadow-amber-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Realm</span>
            </button>
            {auth.authEnabled && (
              <button
                onClick={() => {
                  setToken('');
                  loadAuth();
                }}
                className="p-2 rounded-xl bg-slate-800/70 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition cursor-pointer"
                title="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Mobile Nav */}
        <div className="flex md:hidden border-t border-slate-800/70 px-2 py-1.5 gap-1 overflow-x-auto">
          {(
            [
              { id: 'servers', label: 'Realms' },
              { id: 'worlds', label: 'Worlds' },
              { id: 'mods', label: 'Mods' },
              { id: 'backups', label: 'Backups' },
              { id: 'updates', label: 'Updates' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${
                tab === item.id ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Warnings */}
        {!dockerAvailable && (
          <div className="flex items-center gap-3 rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-xs text-rose-200">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>
              Docker socket is not reachable. Mount{' '}
              <code className="font-mono-code">/var/run/docker.sock</code> into the POK-Valheim
              manager container to start/stop Valheim servers.
            </span>
          </div>
        )}

        {auth.isDefaultPassword && (
          <div className="flex items-center gap-3 rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              You are using the default admin password. Change{' '}
              <code className="font-mono-code">POK_ADMIN_PASS</code> in your{' '}
              <code className="font-mono-code">.env</code> file before exposing this panel.
            </span>
          </div>
        )}

        {/* Summary KPI Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Active Realms</div>
            <div className="text-2xl font-bold text-slate-100 mt-1">
              <span className="text-emerald-400">{runningCount}</span>
              <span className="text-slate-600 text-lg"> / {servers.length}</span>
            </div>
          </div>
          <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Memory Usage</div>
            <div className="text-2xl font-bold text-slate-100 mt-1 font-mono-code">
              {totalRamGb} <span className="text-sm font-normal text-slate-400">GB</span>
            </div>
          </div>
          <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">
              Saved Worlds & Backups
            </div>
            <div className="text-2xl font-bold text-slate-100 mt-1">
              {worlds.length}{' '}
              <span className="text-xs font-normal text-slate-400">
                worlds • {backups.length} backups
              </span>
            </div>
          </div>
          <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Valheim Build</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-lg font-bold font-mono-code text-amber-300">
                {updatePolicy?.installedBuildId || 'Pending'}
              </span>
              {updatePolicy?.updateAvailable ? (
                <button
                  onClick={() => setTab('updates')}
                  className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold cursor-pointer"
                >
                  Update Ready
                </button>
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        {tab === 'servers' && (
          <div className="space-y-6">
            {servers.length === 0 ? (
              <div className="rounded-2xl bg-[#111622]/80 border border-dashed border-slate-700/80 p-12 text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                  <Flame className="w-7 h-7 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-100">
                    Welcome to POK-Valheim
                  </h2>
                  <p className="text-sm text-slate-400 max-w-md mx-auto mt-1">
                    Spin up your first Linux Valheim realm — or run multiple servers side-by-side
                    (Main World, Resource Farm, Creative Builder) to jump back and forth easily.
                  </p>
                </div>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-semibold text-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" /> Create Your First Realm
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {servers.map((srv) => (
                  <ServerCard
                    key={srv.id}
                    server={srv}
                    publicHost={auth.publicHost}
                    busy={busyServerIds.has(srv.id)}
                    onStart={() =>
                      withServerBusy(srv.id, async () => {
                        await api.startServer(srv.id);
                        notify(`Started "${srv.name}"`);
                      })
                    }
                    onStop={() =>
                      withServerBusy(srv.id, async () => {
                        await api.stopServer(srv.id);
                        notify(`Stopped "${srv.name}" gracefully`);
                      })
                    }
                    onRestart={() =>
                      withServerBusy(srv.id, async () => {
                        await api.restartServer(srv.id);
                        notify(`Restarted "${srv.name}"`);
                      })
                    }
                    onOpenConsole={() => setConsoleServer(srv)}
                    onBackup={() =>
                      withServerBusy(srv.id, async () => {
                        await api.createBackup(srv.id, 'Quick backup from dashboard');
                        notify(`Backup created for "${srv.name}"`);
                      })
                    }
                    onEdit={() => {
                      setEditingServer(srv);
                      setShowCreateModal(true);
                    }}
                    onDelete={() => {
                      if (
                        !confirm(
                          `Remove server "${srv.name}"?\n\nIts Docker container will be deleted (world files stay on disk unless manually removed).`
                        )
                      ) {
                        return;
                      }
                      withServerBusy(srv.id, async () => {
                        await api.deleteServer(srv.id, false);
                        notify(`Removed "${srv.name}"`);
                      });
                    }}
                  />
                ))}
              </div>
            )}

            {/* Recent Activity */}
            {activity.length > 0 && (
              <div className="rounded-2xl bg-[#111622]/80 border border-slate-800/80 p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2 mb-3">
                  <Activity className="w-3.5 h-3.5 text-amber-400" /> Recent Activity
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activity.slice(0, 10).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 text-xs py-1 border-b border-slate-800/50 last:border-0"
                    >
                      <span className="text-slate-300">{item.message}</span>
                      <span className="text-[11px] text-slate-500 shrink-0">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'worlds' && (
          <WorldsView
            worlds={worlds}
            servers={servers}
            onRefresh={refreshAll}
            onNotify={notify}
          />
        )}

        {tab === 'mods' && <ModsView servers={servers} onNotify={notify} />}

        {tab === 'backups' && (
          <BackupsView
            backups={backups}
            policy={backupPolicy}
            servers={servers}
            onRefresh={refreshAll}
            onNotify={notify}
          />
        )}

        {tab === 'updates' && (
          <UpdatesView policy={updatePolicy} onRefresh={refreshAll} onNotify={notify} />
        )}
      </main>

      {/* Modals */}
      {showCreateModal && (
        <ServerModal
          existing={editingServer}
          suggestedPort={nextAvailablePort}
          onClose={() => {
            setShowCreateModal(false);
            setEditingServer(null);
          }}
          onSave={async (payload) => {
            if (editingServer) {
              await api.updateServer(editingServer.id, payload);
              notify(`Updated "${payload.name}"`);
            } else {
              await api.createServer(payload);
              notify(`Created realm "${payload.name}"`);
            }
            await refreshAll();
          }}
        />
      )}

      {consoleServer && (
        <ConsoleModal server={consoleServer} onClose={() => setConsoleServer(null)} />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl border text-xs font-medium shadow-2xl backdrop-blur-md ${
            toast.isError
              ? 'bg-rose-950/90 border-rose-500/40 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
