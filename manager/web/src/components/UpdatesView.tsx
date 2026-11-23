import { useState } from 'react';
import {
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  Save,
  Terminal,
} from 'lucide-react';
import { api } from '../api';
import type { UpdatePolicy } from '../types';

interface UpdatesViewProps {
  policy: UpdatePolicy | null;
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function UpdatesView({ policy, onRefresh, onNotify }: UpdatesViewProps) {
  const [checking, setChecking] = useState(false);
  const [startingUpdate, setStartingUpdate] = useState(false);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(policy?.autoCheckEnabled ?? true);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(policy?.autoUpdateEnabled ?? false);
  const [checkCronExpression, setCheckCronExpression] = useState(
    policy?.checkCronExpression ?? '0 * * * *'
  );
  const [saving, setSaving] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await api.checkUpdates();
      onNotify(
        res.updateAvailable
          ? `New Valheim build available: ${res.latestBuildId}`
          : 'Valheim Dedicated Server is up to date!'
      );
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setChecking(false);
    }
  };

  const handleRunUpdate = async () => {
    if (
      !confirm(
        'Update Valheim Dedicated Server now?\n\nAll running servers will gracefully save and stop, back up (if enabled), update via SteamCMD, and restart automatically.'
      )
    ) {
      return;
    }
    setStartingUpdate(true);
    try {
      await api.runUpdate();
      onNotify('Valheim SteamCMD update started!');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setStartingUpdate(false);
    }
  };

  const handleSavePolicy = async () => {
    setSaving(true);
    try {
      await api.updateUpdatePolicy({
        autoCheckEnabled,
        autoUpdateEnabled,
        checkCronExpression,
      });
      onNotify('Auto-update settings saved!');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                policy?.updateAvailable
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
              }`}
            >
              {policy?.updateAvailable ? (
                <AlertTriangle className="w-6 h-6" />
              ) : (
                <CheckCircle2 className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {policy?.isUpdating
                  ? 'Updating Valheim Dedicated Server...'
                  : policy?.updateAvailable
                    ? 'New Valheim Build Available!'
                    : 'Valheim Dedicated Server is Up to Date'}
              </h3>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-1.5 text-xs text-slate-400">
                <span>
                  Installed Build:{' '}
                  <strong className="font-mono-code text-slate-200">
                    {policy?.installedBuildId || 'Not installed yet'}
                  </strong>
                </span>
                <span>
                  Latest Steam Build:{' '}
                  <strong className="font-mono-code text-amber-300">
                    {policy?.latestBuildId || 'Unknown'}
                  </strong>
                </span>
                {policy?.lastCheckedAt && (
                  <span>Checked: {new Date(policy.lastCheckedAt).toLocaleString()}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleCheck}
              disabled={checking || policy?.isUpdating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              Check Steam
            </button>
            <button
              onClick={handleRunUpdate}
              disabled={startingUpdate || policy?.isUpdating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              {policy?.isUpdating ? 'Updating...' : 'Update Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Auto-Update Policy */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-100">Auto-Update Automation</h3>
        <p className="text-xs text-slate-400">
          POK-Valheim monitors Steam AppID <code className="text-amber-300">896660</code> for new
          public builds. When Auto-Update is enabled, running servers are gracefully saved, backed
          up, updated via the shared SteamCMD volume, and restarted automatically.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <label className="flex items-center gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={autoCheckEnabled}
              onChange={(e) => setAutoCheckEnabled(e.target.checked)}
              className="accent-amber-500"
            />
            <div>
              <div className="font-semibold">Scheduled Steam Check</div>
              <div className="text-[11px] text-slate-400">Poll Steam for new build IDs</div>
            </div>
          </label>

          <label className="flex items-center gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={autoUpdateEnabled}
              onChange={(e) => setAutoUpdateEnabled(e.target.checked)}
              className="accent-amber-500"
            />
            <div>
              <div className="font-semibold">Auto-Install Updates</div>
              <div className="text-[11px] text-slate-400">Gracefully stop, update & restart</div>
            </div>
          </label>

          <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
            <label className="block text-[11px] text-slate-400 mb-1">Check Schedule (Cron)</label>
            <input
              type="text"
              value={checkCronExpression}
              onChange={(e) => setCheckCronExpression(e.target.value)}
              className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-1.5 text-xs font-mono-code text-slate-100"
            />
          </div>
        </div>

        <button
          onClick={handleSavePolicy}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold cursor-pointer"
        >
          <Save className="w-3.5 h-3.5 text-amber-400" />
          {saving ? 'Saving...' : 'Save Update Policy'}
        </button>
      </div>

      {/* Update Output Console */}
      <div className="rounded-2xl bg-[#07090e] border border-slate-800/80 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2 text-xs font-medium text-slate-300">
          <Terminal className="w-4 h-4 text-amber-400" />
          SteamCMD Update Log
        </div>
        <div className="p-4 h-64 overflow-y-auto font-mono-code text-xs text-slate-300 space-y-1">
          {!policy?.updateLog || policy.updateLog.length === 0 ? (
            <p className="text-slate-500 italic">No update logs recorded yet.</p>
          ) : (
            policy.updateLog.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
