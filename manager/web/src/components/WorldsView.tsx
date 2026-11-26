import { useState, useRef } from 'react';
import {
  Globe,
  Upload,
  Copy,
  Download,
  Trash2,
  ArrowRightLeft,
  CheckCircle2,
  FolderArchive,
  Play,
} from 'lucide-react';
import { api, copyToClipboard } from '../api';
import type { ServerWithStatus, WorldSaveInfo } from '../types';

interface WorldsViewProps {
  worlds: WorldSaveInfo[];
  servers: ServerWithStatus[];
  onRefresh: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function WorldsView({ worlds, servers, onRefresh, onNotify }: WorldsViewProps) {
  const [uploadTarget, setUploadTarget] = useState('vault');
  const [uploading, setUploading] = useState(false);
  const [cloneModal, setCloneModal] = useState<{
    world: WorldSaveInfo;
    targetLocation: string;
    newName: string;
  } | null>(null);
  const [activateModal, setActivateModal] = useState<{
    world: WorldSaveInfo;
    serverId: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const res = await api.uploadWorlds(uploadTarget, Array.from(files));
      onNotify(`Uploaded world save(s): ${res.worlds.join(', ') || 'done'}`);
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClone = async () => {
    if (!cloneModal) return;
    try {
      await api.cloneWorld({
        sourceLocation: cloneModal.world.location,
        worldName: cloneModal.world.name,
        targetLocation: cloneModal.targetLocation,
        newWorldName: cloneModal.newName.trim() || cloneModal.world.name,
      });
      onNotify(`Copied "${cloneModal.world.name}" successfully!`);
      setCloneModal(null);
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleActivate = async () => {
    if (!activateModal) return;
    try {
      await api.activateWorld({
        serverId: activateModal.serverId,
        worldName: activateModal.world.name,
        sourceLocation: activateModal.world.location,
      });
      onNotify(`Switched server active world to "${activateModal.world.name}"!`);
      setActivateModal(null);
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  const handleDelete = async (w: WorldSaveInfo) => {
    if (!confirm(`Delete world "${w.name}" from ${w.locationLabel}? This cannot be undone.`)) return;
    try {
      await api.deleteWorld(w.location, w.name);
      onNotify(`Deleted world "${w.name}"`);
      onRefresh();
    } catch (err) {
      onNotify((err as Error).message, true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Card */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Upload className="w-4 h-4 text-amber-400" />
              Import Existing Valheim Saves
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Upload <code className="text-amber-300">.db</code> and{' '}
              <code className="text-amber-300">.fwl</code> files (or a{' '}
              <code className="text-amber-300">.zip</code>) into the shared World Vault or directly
              into any server.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={uploadTarget}
              onChange={(e) => setUploadTarget(e.target.value)}
              className="rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-xs text-slate-200"
            >
              <option value="vault">World Vault (Shared Library)</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  Server: {s.name}
                </option>
              ))}
            </select>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".db,.fwl,.zip"
              className="hidden"
              onChange={(e) => handleUploadFiles(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              {uploading ? 'Uploading...' : 'Upload Save Files'}
            </button>
          </div>
        </div>
      </div>

      {/* Worlds Table */}
      <div className="rounded-2xl bg-[#111622]/90 border border-slate-800/80 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <FolderArchive className="w-4 h-4 text-amber-400" />
            Worlds & Saves ({worlds.length})
          </h3>
          <span className="text-xs text-slate-400">
            Copy worlds between servers or hot-swap active saves
          </span>
        </div>

        {worlds.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            No world saves found yet. Start a server to generate a world, or upload your local{' '}
            <code className="text-amber-300">.db / .fwl</code> files above.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#0b0f18] text-slate-400 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-5 py-3">World Name</th>
                  <th className="px-5 py-3">Seed</th>
                  <th className="px-5 py-3">Location</th>
                  <th className="px-5 py-3">Files</th>
                  <th className="px-5 py-3">Size</th>
                  <th className="px-5 py-3">Last Modified</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {worlds.map((w) => (
                  <tr
                    key={`${w.location}-${w.name}`}
                    className="hover:bg-slate-800/25 transition"
                  >
                    <td className="px-5 py-3.5 font-medium text-slate-100">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-amber-400/80 shrink-0" />
                        <span className="font-mono-code">{w.name}</span>
                        {w.isActiveOnServer && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" /> Active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono-code">
                      {w.seed ? (
                        <button
                          onClick={async () => {
                            await copyToClipboard(w.seed || '');
                            onNotify(`Copied seed "${w.seed}"`);
                          }}
                          className="inline-flex items-center gap-1.5 text-emerald-300 hover:text-emerald-200 cursor-pointer"
                          title="Click to copy seed"
                        >
                          <span>{w.seed}</span>
                          <Copy className="w-3 h-3 text-slate-500" />
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-300">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[11px] ${
                          w.location === 'vault'
                            ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        {w.locationLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-mono-code text-slate-400">
                      {w.isFolder ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[11px]">
                          Valheim 1.0 Folder
                        </span>
                      ) : (
                        [w.hasDb ? '.db' : null, w.hasFwl ? '.fwl' : null]
                          .filter(Boolean)
                          .join(' + ')
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-mono-code text-slate-300">
                      {formatBytes(w.totalSizeBytes)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">
                      {new Date(w.lastModified).toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {servers.length > 0 && (
                          <button
                            onClick={() =>
                              setActivateModal({
                                world: w,
                                serverId: w.location !== 'vault' ? w.location : servers[0].id,
                              })
                            }
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium cursor-pointer"
                            title="Load this world on a server"
                          >
                            <Play className="w-3 h-3" /> Load
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setCloneModal({
                              world: w,
                              targetLocation: w.location === 'vault' && servers[0] ? servers[0].id : 'vault',
                              newName: w.name,
                            })
                          }
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-medium cursor-pointer"
                          title="Copy / Transfer to another server or Vault"
                        >
                          <ArrowRightLeft className="w-3 h-3" /> Copy
                        </button>
                        <a
                          href={api.getWorldDownloadUrl(w.location, w.name)}
                          className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-sky-300"
                          title="Download .zip"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          onClick={() => handleDelete(w)}
                          className="p-1.5 rounded-lg hover:bg-rose-500/15 text-slate-500 hover:text-rose-400 cursor-pointer"
                          title="Delete world"
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

      {/* Clone Modal */}
      {cloneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#111622] border border-slate-700 p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Copy className="w-4 h-4 text-amber-400" />
              Copy World "{cloneModal.world.name}"
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Destination</label>
                <select
                  value={cloneModal.targetLocation}
                  onChange={(e) =>
                    setCloneModal({ ...cloneModal, targetLocation: e.target.value })
                  }
                  className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="vault">World Vault (Shared Library)</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      Server: {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Target World Name</label>
                <input
                  type="text"
                  value={cloneModal.newName}
                  onChange={(e) => setCloneModal({ ...cloneModal, newName: e.target.value })}
                  className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-sm text-slate-100 font-mono-code"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCloneModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleClone}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Copy Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activate Modal */}
      {activateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#111622] border border-slate-700 p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-100">
              Load World "{activateModal.world.name}"
            </h3>
            <p className="text-xs text-slate-400">
              Choose which server should load this world. If the world is in another location, it
              will be copied to the target server automatically and the server will restart cleanly.
            </p>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Target Server</label>
              <select
                value={activateModal.serverId}
                onChange={(e) =>
                  setActivateModal({ ...activateModal, serverId: e.target.value })
                }
                className="w-full rounded-xl bg-[#0b0f18] border border-slate-700 px-3 py-2 text-sm text-slate-100"
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Currently: {s.worldName})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setActivateModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleActivate}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Activate World
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
