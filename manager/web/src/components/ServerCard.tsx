import { useState } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Terminal,
  Archive,
  Settings,
  Trash2,
  Copy,
  Check,
  Globe,
  Cpu,
  HardDrive,
  Clock,
  KeyRound,
  Sparkles,
  Users,
  Save,
} from 'lucide-react';
import type { ServerWithStatus } from '../types';

interface ServerCardProps {
  server: ServerWithStatus;
  publicHost: string;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenConsole: () => void;
  onBackup: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function formatUptime(sec: number | null): string {
  if (sec === null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ServerCard({
  server,
  publicHost,
  busy,
  onStart,
  onStop,
  onRestart,
  onOpenConsole,
  onBackup,
  onEdit,
  onDelete,
}: ServerCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const isRunning = server.runtime.state === 'running';
  const isReady = isRunning && server.runtime.ready;
  const hostDisplay = publicHost || window.location.hostname;
  const connectStr = `${hostDisplay}:${server.port}`;

  const copyText = (field: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  // Build concise modifier pills
  const pills: string[] = [];
  if (server.rconEnabled) pills.push(`RCON :${server.rconPort || server.port + 2}`);
  if (server.crossplay) pills.push('Crossplay');
  if (server.modifiers.preset) pills.push(`Preset: ${server.modifiers.preset}`);
  if (server.modifiers.resources) pills.push(`Resources: ${server.modifiers.resources}`);
  if (server.modifiers.portals) pills.push(`Portals: ${server.modifiers.portals}`);
  if (server.modifiers.combat) pills.push(`Combat: ${server.modifiers.combat}`);
  if (server.modifiers.noBuildCost) pills.push('No Build Cost');
  if (server.modifiers.passiveMobs) pills.push('Passive Mobs');
  if (server.modifiers.noMap) pills.push('No Map');
  if (server.modifiers.fire) pills.push('Fire Hazards');
  if (server.modifiers.dungeonBuild) pills.push('Dungeon Build');

  return (
    <div
      onClick={onEdit}
      className="group rounded-2xl bg-[#111622]/90 border border-slate-800/80 hover:border-amber-500/45 transition-all duration-200 p-5 flex flex-col justify-between shadow-lg shadow-black/30 cursor-pointer"
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                  isReady
                    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse'
                    : isRunning
                      ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)] animate-pulse'
                      : 'bg-slate-600'
                }`}
              />
              <h3 className="text-base font-semibold text-slate-100 truncate">{server.name}</h3>
            </div>
            {server.description && (
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{server.description}</p>
            )}
          </div>

          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide shrink-0 border ${
              isReady
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : isRunning
                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  : 'bg-slate-800/80 text-slate-400 border-slate-700/70'
            }`}
          >
            {server.runtime.statusText}
          </span>
        </div>

        {/* World & Connection Info */}
        <div className="rounded-xl bg-[#0b0f18] border border-slate-800/70 p-3 space-y-2 mb-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-amber-400/80" /> World
            </span>
            <span className="font-mono-code text-amber-200 font-medium">
              {server.worldName}
              {server.runtime.worldDay ? (
                <span className="text-slate-400 ml-1.5 font-sans text-[11px]">
                  (Day {server.runtime.worldDay})
                </span>
              ) : null}
            </span>
          </div>

          {server.runtime.worldSeed && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Seed</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyText('seed', server.runtime.worldSeed || '');
                }}
                className="flex items-center gap-1.5 font-mono-code text-emerald-300 hover:text-emerald-200 transition cursor-pointer"
                title="Copy world seed"
              >
                <span>{server.runtime.worldSeed}</span>
                {copiedField === 'seed' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Connect</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyText('addr', connectStr);
              }}
              className="flex items-center gap-1.5 font-mono-code text-slate-200 hover:text-amber-300 transition cursor-pointer"
              title="Copy server address"
            >
              <span>{connectStr}</span>
              {copiedField === 'addr' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-500" /> Password
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyText('pass', server.password);
              }}
              className="flex items-center gap-1.5 font-mono-code text-slate-300 hover:text-amber-300 transition cursor-pointer"
              title="Copy server password"
            >
              <span>{'•'.repeat(Math.min(10, server.password.length))}</span>
              {copiedField === 'pass' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          </div>

          {server.runtime.joinCode && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
              <span className="text-sky-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> PlayFab Code
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyText('code', server.runtime.joinCode || '');
                }}
                className="flex items-center gap-1.5 font-mono-code text-sky-200 hover:text-sky-100 cursor-pointer"
              >
                <span>{server.runtime.joinCode}</span>
                {copiedField === 'code' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-sky-400/70" />
                )}
              </button>
            </div>
          )}

          {isRunning && (
            <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800/80">
              <span className="text-slate-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-400/80" /> Players
              </span>
              <span className="text-slate-200 font-medium truncate max-w-[180px]">
                {server.runtime.playersOnline > 0
                  ? `${server.runtime.playersOnline} online${
                      server.runtime.onlinePlayerNames.length > 0
                        ? ` (${server.runtime.onlinePlayerNames.join(', ')})`
                        : ''
                    }`
                  : '0 online'}
              </span>
            </div>
          )}
        </div>

        {/* Modifiers Pills */}
        {pills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {pills.map((pill) => (
              <span
                key={pill}
                className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200/90"
              >
                {pill}
              </span>
            ))}
          </div>
        )}

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="rounded-lg bg-[#0d121d] border border-slate-800/60 px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              <Cpu className="w-3 h-3" /> CPU
            </div>
            <div className="text-xs font-mono-code font-medium text-slate-200 mt-0.5">
              {isRunning ? `${server.runtime.cpuPercent}%` : '0%'}
            </div>
          </div>
          <div className="rounded-lg bg-[#0d121d] border border-slate-800/60 px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              <HardDrive className="w-3 h-3" /> RAM
            </div>
            <div className="text-xs font-mono-code font-medium text-slate-200 mt-0.5">
              {isRunning ? `${(server.runtime.memoryMb / 1024).toFixed(2)} GB` : '—'}
            </div>
          </div>
          <div className="rounded-lg bg-[#0d121d] border border-slate-800/60 px-2.5 py-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              <Clock className="w-3 h-3" /> Uptime
            </div>
            <div className="text-xs font-mono-code font-medium text-slate-200 mt-0.5">
              {isRunning ? formatUptime(server.runtime.uptimeSeconds) : '—'}
            </div>
          </div>
        </div>

        {isRunning && server.runtime.lastSavedAt && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mb-3">
            <Save className="w-3 h-3 text-slate-500" />
            <span>Last world save: {server.runtime.lastSavedAt}</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/70"
      >
        <div className="flex items-center gap-1.5">
          {!isRunning ? (
            <button
              onClick={onStart}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" /> Start
            </button>
          ) : (
            <>
              <button
                onClick={onStop}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
                title="Gracefully saves world before stopping"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
              <button
                onClick={onRestart}
                disabled={busy}
                className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-slate-300 transition disabled:opacity-40 cursor-pointer"
                title="Restart server"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            onClick={onOpenConsole}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition cursor-pointer"
            title="Open Live Console & RCON Commands"
          >
            <Terminal className="w-3.5 h-3.5" /> RCON
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onBackup}
            disabled={busy}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-300 transition cursor-pointer"
            title="Backup Now"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition cursor-pointer"
            title="Configure Server & In-Game Rules"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="p-1.5 rounded-lg hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 transition cursor-pointer"
            title="Delete Server"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
