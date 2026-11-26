import { useEffect, useState } from 'react';
import {
  RefreshCw,
  DownloadCloud,
  CheckCircle2,
  AlertTriangle,
  Save,
  Terminal,
  Users,
  Timer,
  Zap,
  Bell,
  Radio,
  XCircle,
  Send,
} from 'lucide-react';
import { api } from '../api';
import type { UpdatePlayerPolicy, UpdatePolicy } from '../types';

interface UpdatesViewProps {
  policy: UpdatePolicy | null;
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export function UpdatesView({ policy, onRefresh, onNotify }: UpdatesViewProps) {
  const [checking, setChecking] = useState(false);
  const [startingUpdate, setStartingUpdate] = useState(false);
  const [testingBroadcast, setTestingBroadcast] = useState(false);
  const [saving, setSaving] = useState(false);

  const [autoCheckEnabled, setAutoCheckEnabled] = useState(policy?.autoCheckEnabled ?? true);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(policy?.autoUpdateEnabled ?? false);
  const [checkCronExpression, setCheckCronExpression] = useState(
    policy?.checkCronExpression ?? '0 * * * *'
  );
  const [whenPlayersOnline, setWhenPlayersOnline] = useState<UpdatePlayerPolicy>(
    policy?.whenPlayersOnline ?? 'wait_until_empty'
  );
  const [countdownMinutes, setCountdownMinutes] = useState(policy?.countdownMinutes ?? 5);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState(policy?.discordWebhookUrl ?? '');
  const [rconEnabled, setRconEnabled] = useState(policy?.rconEnabled ?? false);
  const [rconHost, setRconHost] = useState(policy?.rconHost ?? '127.0.0.1');
  const [rconPort, setRconPort] = useState(policy?.rconPort ?? 2458);
  const [rconPassword, setRconPassword] = useState(policy?.rconPassword ?? '');
  const [rconCommandTemplate, setRconCommandTemplate] = useState(
    policy?.rconCommandTemplate ?? 'say {message}'
  );

  useEffect(() => {
    if (!policy) return;
    setAutoCheckEnabled(policy.autoCheckEnabled);
    setAutoUpdateEnabled(policy.autoUpdateEnabled);
    setCheckCronExpression(policy.checkCronExpression);
    setWhenPlayersOnline(policy.whenPlayersOnline ?? 'wait_until_empty');
    setCountdownMinutes(policy.countdownMinutes ?? 5);
    setDiscordWebhookUrl(policy.discordWebhookUrl ?? '');
    setRconEnabled(Boolean(policy.rconEnabled));
    setRconHost(policy.rconHost || '127.0.0.1');
    setRconPort(policy.rconPort || 2458);
    setRconPassword(policy.rconPassword || '');
    setRconCommandTemplate(policy.rconCommandTemplate || 'say {message}');
  }, [policy?.lastCheckedAt]);

  const isBusy = Boolean(policy?.isUpdating || (policy?.pendingState && policy.pendingState !== 'idle'));

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

  const handleRunUpdate = async (forceImmediate = false) => {
    const label = forceImmediate
      ? 'Force update immediately (ignores online players)?'
      : 'Start Valheim update using your player-safety policy?';
    if (!confirm(label)) return;
    setStartingUpdate(true);
    try {
      await api.runUpdate(forceImmediate);
      onNotify('Valheim update workflow started!');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setStartingUpdate(false);
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancelUpdate();
      onNotify('Pending update cancelled');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleSavePolicy = async () => {
    setSaving(true);
    try {
      await api.updateUpdatePolicy({
        autoCheckEnabled,
        autoUpdateEnabled,
        checkCronExpression,
        whenPlayersOnline,
        countdownMinutes: Number(countdownMinutes),
        discordWebhookUrl,
        rconEnabled,
        rconHost,
        rconPort: Number(rconPort),
        rconPassword,
        rconCommandTemplate,
      });
      onNotify('Auto-update & notification settings saved!');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  const handleTestBroadcast = async () => {
    setTestingBroadcast(true);
    try {
      // Save latest webhook/RCON settings first so test uses current form values
      await api.updateUpdatePolicy({
        discordWebhookUrl,
        rconEnabled,
        rconHost,
        rconPort: Number(rconPort),
        rconPassword,
        rconCommandTemplate,
      });
      const res = await api.testBroadcast(
        'Test broadcast from POK-Valheim Manager — update announcements are working!'
      );
      onNotify(`Broadcast result — Discord: ${res.result.discord} | RCON: ${res.result.rcon}`);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setTestingBroadcast(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Pending Countdown / Waiting Banner */}
      {policy && policy.pendingState !== 'idle' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/40 px-5 py-4">
          <div className="flex items-center gap-3">
            <Timer className="w-5 h-5 text-amber-400 animate-pulse shrink-0" />
            <div>
              <div className="text-sm font-semibold text-amber-200">
                {policy.pendingState === 'waiting_for_empty'
                  ? 'Update Pending — Waiting for Players to Log Off'
                  : policy.pendingState === 'countdown'
                    ? 'Update Countdown Active'
                    : 'Updating Valheim Dedicated Server...'}
              </div>
              <div className="text-xs text-amber-300/80 mt-0.5">{policy.pendingMessage}</div>
            </div>
          </div>
          {policy.pendingState !== 'updating' && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-semibold cursor-pointer shrink-0"
            >
              <XCircle className="w-4 h-4" /> Cancel Pending Update
            </button>
          )}
        </div>
      )}

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

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleCheck}
              disabled={checking || isBusy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              Check Steam
            </button>
            <button
              onClick={() => handleRunUpdate(false)}
              disabled={startingUpdate || isBusy}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
            >
              <DownloadCloud className="w-3.5 h-3.5" />
              {isBusy ? 'In Progress...' : 'Update Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Auto-Update & Player Safety Policy */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Auto-Update &amp; Online Player Safety
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Control what happens when a new Steam build (<code className="text-amber-300">896660</code>)
            is released while players are connected.
          </p>
        </div>

        {/* Schedule Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              <div className="text-[11px] text-slate-400">Automatically run update workflow</div>
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

        {/* When Players Are Online Selector */}
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
            When Players Are Online
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(
              [
                {
                  id: 'wait_until_empty',
                  title: 'Wait Until Everyone Logs Off',
                  desc: 'Never kicks players. Polls every 60s and updates as soon as all realms are empty.',
                  icon: Users,
                },
                {
                  id: 'countdown',
                  title: 'Countdown Warning & Restart',
                  desc: 'Broadcasts timed warnings (5m, 2m, 1m, 30s, 10s) via Discord/RCON before restarting.',
                  icon: Timer,
                },
                {
                  id: 'immediate',
                  title: 'Update Immediately',
                  desc: 'Gracefully saves worlds and restarts right away without waiting.',
                  icon: Zap,
                },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const selected = whenPlayersOnline === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setWhenPlayersOnline(opt.id)}
                  className={`text-left rounded-xl p-4 border transition cursor-pointer ${
                    selected
                      ? 'bg-amber-500/10 border-amber-500/50'
                      : 'bg-[#0b0f18] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mb-2 ${selected ? 'text-amber-400' : 'text-slate-400'}`}
                  />
                  <div className="text-xs font-semibold text-slate-100">{opt.title}</div>
                  <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">{opt.desc}</div>
                </button>
              );
            })}
          </div>

          {whenPlayersOnline === 'countdown' && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 px-4 py-3 w-fit">
              <label className="text-xs text-slate-300 font-medium">Countdown Duration:</label>
              <input
                type="number"
                min={1}
                max={60}
                value={countdownMinutes}
                onChange={(e) => setCountdownMinutes(Number(e.target.value))}
                className="w-20 rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-1 text-xs font-mono-code text-amber-300"
              />
              <span className="text-xs text-slate-400">minutes</span>
            </div>
          )}
        </div>

        {/* Notifications & RCON Broadcast */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
          {/* Discord Webhook */}
          <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-4 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Bell className="w-4 h-4 text-sky-400" />
              Discord Webhook Alerts (Works Vanilla)
            </div>
            <p className="text-[11px] text-slate-400">
              Posts update pending, countdown warnings, and restart-complete notices directly to
              your Discord channel.
            </p>
            <input
              type="url"
              value={discordWebhookUrl}
              onChange={(e) => setDiscordWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full rounded-lg bg-[#121826] border border-slate-700 px-3 py-2 text-xs font-mono-code text-slate-100"
            />
          </div>

          {/* Source RCON Broadcast */}
          <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                <Radio className="w-4 h-4 text-amber-400" />
                In-Game RCON Broadcast (Optional)
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rconEnabled}
                  onChange={(e) => setRconEnabled(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Enable RCON</span>
              </label>
            </div>
            <p className="text-[11px] text-slate-400">
              Sends in-game chat warnings via Source RCON (requires a Valheim RCON BepInEx plugin
              installed on the server).
            </p>
            {rconEnabled && (
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={rconHost}
                  onChange={(e) => setRconHost(e.target.value)}
                  placeholder="RCON Host (e.g. 192.168.1.193)"
                  className="rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-1.5 text-xs font-mono-code text-slate-100"
                />
                <input
                  type="number"
                  value={rconPort}
                  onChange={(e) => setRconPort(Number(e.target.value))}
                  placeholder="Port (e.g. 2458)"
                  className="rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-1.5 text-xs font-mono-code text-slate-100"
                />
                <input
                  type="password"
                  value={rconPassword}
                  onChange={(e) => setRconPassword(e.target.value)}
                  placeholder="RCON Password"
                  className="rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-1.5 text-xs font-mono-code text-slate-100"
                />
                <input
                  type="text"
                  value={rconCommandTemplate}
                  onChange={(e) => setRconCommandTemplate(e.target.value)}
                  placeholder="say {message}"
                  className="rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-1.5 text-xs font-mono-code text-slate-100"
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={handleSavePolicy}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Update Policy'}
          </button>

          <button
            onClick={handleTestBroadcast}
            disabled={testingBroadcast || (!discordWebhookUrl.trim() && !rconEnabled)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-40"
          >
            <Send className="w-3.5 h-3.5 text-sky-400" />
            {testingBroadcast ? 'Sending...' : 'Send Test Broadcast'}
          </button>
        </div>
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
