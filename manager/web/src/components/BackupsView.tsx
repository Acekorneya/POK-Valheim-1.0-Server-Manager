import { useState } from 'react';
import {
  Archive,
  RotateCcw,
  Download,
  Trash2,
  Clock,
  Save,
  Plus,
} from 'lucide-react';
import { api } from '../api';
import type { BackupEntry, BackupPolicy, ServerWithStatus } from '../types';

interface BackupsViewProps {
  backups: BackupEntry[];
  policy: BackupPolicy | null;
  servers: ServerWithStatus[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const CRON_PRESETS = [
  { label: 'Every 2 hours', value: '0 */2 * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Daily at 4:00 AM', value: '0 4 * * *' },
];

export function BackupsView({
  backups,
  policy,
  servers,
  onRefresh,
  onNotify,
}: BackupsViewProps) {
  const [selectedServer, setSelectedServer] = useState(servers[0]?.id || '');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(policy?.enabled ?? true);
  const [cronExpression, setCronExpression] = useState(policy?.cronExpression ?? '0 */6 * * *');
  const [retentionCount, setRetentionCount] = useState(policy?.retentionCount ?? 15);
  const [backupBeforeUpdate, setBackupBeforeUpdate] = useState(policy?.backupBeforeUpdate ?? true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const handleManualBackup = async () => {
    const targetId = selectedServer || servers[0]?.id;
    if (!targetId) return;
    setCreating(true);
    try {
      await api.createBackup(targetId, note.trim() || undefined);
      setNote('');
      onNotify('Backup created successfully!');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setCreating(false);
    }
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    try {
      await api.updateBackupPolicy({
        enabled,
        cronExpression,
        retentionCount: Number(retentionCount),
        backupBeforeUpdate,
      });
      onNotify('Automated backup policy saved!');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleRestore = async (b: BackupEntry) => {
    if (
      !confirm(
        `Restore "${b.filename}" to server "${b.serverName}"?\n\nA safety snapshot of the current world will be taken automatically before restoring.`
      )
    ) {
      return;
    }
    setRestoringId(b.id);
    try {
      await api.restoreBackup(b.id, true);
      onNotify(`Restored "${b.serverName}" from backup!`);
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (b: BackupEntry) => {
    if (!confirm(`Delete backup "${b.filename}"?`)) return;
    try {
      await api.deleteBackup(b.id);
      onNotify('Backup deleted');
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Manual Backup */}
        <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Plus className="w-4 h-4 text-amber-400" />
            Create Instant Snapshot
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Server</label>
              <select
                value={selectedServer || servers[0]?.id || ''}
                onChange={(e) => setSelectedServer(e.target.value)}
                disabled={servers.length === 0}
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-xs text-slate-100"
              >
                {servers.length === 0 && <option value="">No servers configured</option>}
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (World: {s.worldName})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Before Ashlands boss fight"
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <button
              onClick={handleManualBackup}
              disabled={creating || servers.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
            >
              <Archive className="w-3.5 h-3.5" />
              {creating ? 'Creating Backup...' : 'Backup Now'}
            </button>
          </div>
        </div>

        {/* Automated Backup Schedule */}
        <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-400" />
              Automated Backup Schedule
            </h3>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-amber-500"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Schedule (Cron)</label>
              <input
                type="text"
                value={cronExpression}
                onChange={(e) => setCronExpression(e.target.value)}
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-xs font-mono-code text-slate-100"
              />
              <div className="flex flex-wrap gap-1 mt-1.5">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setCronExpression(p.value)}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 cursor-pointer"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Keep Last N Backups (per server)
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={retentionCount}
                onChange={(e) => setRetentionCount(Number(e.target.value))}
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-xs font-mono-code text-slate-100"
              />
              <label className="flex items-center gap-2 text-xs text-slate-300 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={backupBeforeUpdate}
                  onChange={(e) => setBackupBeforeUpdate(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Auto-backup before Steam updates</span>
              </label>
            </div>
          </div>

          <button
            onClick={handleSavePolicy}
            disabled={savingPolicy}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-xs transition cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-amber-400" />
            {savingPolicy ? 'Saving...' : 'Save Schedule'}
          </button>
        </div>
      </div>

      {/* Backups List */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">
            Backup History ({backups.length})
          </h3>
          <span className="text-xs text-slate-400">
            One-click restore safely stops the server & snapshots current state first
          </span>
        </div>

        {backups.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            No backups created yet. Click <strong>Backup Now</strong> above to create your first
            snapshot.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0b0f18] text-slate-400 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-3">Server / World</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Note</th>
                  <th className="px-5 py-3">Size</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {backups.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-800/25 transition">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-100">{b.serverName}</div>
                      <div className="text-[11px] font-mono-code text-slate-400">{b.worldName}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          b.trigger === 'manual'
                            ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                            : b.trigger === 'scheduled'
                              ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                              : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                        }`}
                      >
                        {b.trigger}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-300 max-w-xs truncate">
                      {b.note || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-5 py-3.5 font-mono-code text-slate-300">
                      {formatBytes(b.sizeBytes)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleRestore(b)}
                          disabled={restoringId === b.id}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          {restoringId === b.id ? 'Restoring...' : 'Restore'}
                        </button>
                        <a
                          href={api.getBackupDownloadUrl(b.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-300"
                          title="Download .tar.gz"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => handleDelete(b)}
                          className="p-1.5 rounded-lg hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 cursor-pointer"
                          title="Delete backup"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
