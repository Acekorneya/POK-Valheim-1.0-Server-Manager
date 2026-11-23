import { useEffect, useRef, useState } from 'react';
import { X, Terminal, Users, Save, RefreshCw } from 'lucide-react';
import { api, getToken } from '../api';
import type { PlayerLists, ServerWithStatus } from '../types';

interface ConsoleModalProps {
  server: ServerWithStatus;
  onClose: () => void;
}

export function ConsoleModal({ server, onClose }: ConsoleModalProps) {
  const [tab, setTab] = useState<'logs' | 'lists'>('logs');
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [lists, setLists] = useState<PlayerLists>({
    adminlist: '',
    bannedlist: '',
    permittedlist: '',
  });
  const [savingLists, setSavingLists] = useState(false);
  const [listMessage, setListMessage] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken();
    const wsUrl = `${protocol}//${window.location.host}/ws/logs?serverId=${encodeURIComponent(server.id)}&token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as { type: string; line?: string; message?: string };
        if (msg.type === 'log' && msg.line !== undefined) {
          setLines((prev) => [...prev.slice(-600), msg.line!]);
        } else if (msg.type === 'error' && msg.message) {
          setLines((prev) => [...prev, `[ERROR] ${msg.message}`]);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      ws.close();
    };
  }, [server.id]);

  useEffect(() => {
    if (tab === 'logs') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [lines, tab]);

  useEffect(() => {
    api.getPlayerLists(server.id).then(setLists).catch(() => {});
  }, [server.id]);

  const handleSaveLists = async () => {
    setSavingLists(true);
    setListMessage('');
    try {
      await api.savePlayerLists(server.id, lists);
      setListMessage('Player access lists saved!');
      setTimeout(() => setListMessage(''), 2500);
    } catch (err) {
      setListMessage(`Error: ${(err as Error).message}`);
    } finally {
      setSavingLists(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl h-[82vh] flex flex-col rounded-2xl bg-[#111622] border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#0d121d]">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{server.name}</h2>
              <p className="text-[11px] text-slate-400 font-mono-code">
                {server.runtime.containerName} • World: {server.worldName} • Port {server.port}/udp
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-[#090c12] p-0.5 border border-slate-800">
              <button
                onClick={() => setTab('logs')}
                className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  tab === 'logs'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Live Console
              </button>
              <button
                onClick={() => setTab('lists')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                  tab === 'lists'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Player Lists
              </button>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        {tab === 'logs' ? (
          <div className="flex-1 flex flex-col min-h-0 bg-[#07090e]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/70 text-[11px] text-slate-400">
              <span className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                {connected ? 'Live stream connected' : 'Stream disconnected'}
              </span>
              <button
                onClick={() => setLines([])}
                className="flex items-center gap-1 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono-code text-xs leading-relaxed text-slate-300 space-y-0.5">
              {lines.length === 0 ? (
                <p className="text-slate-500 italic">Waiting for container log output...</p>
              ) : (
                lines.map((line, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all ${
                      line.toLowerCase().includes('error')
                        ? 'text-rose-400'
                        : line.toLowerCase().includes('join code')
                          ? 'text-sky-300 font-semibold'
                          : line.includes('[POK-Valheim')
                            ? 'text-amber-300'
                            : 'text-slate-300'
                    }`}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <p className="text-xs text-slate-400">
              Enter one SteamID64 (or PlayFab ID when Crossplay is enabled) per line. Changes apply
              live in Valheim without needing a restart.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                  adminlist.txt
                </label>
                <textarea
                  rows={12}
                  value={lists.adminlist}
                  onChange={(e) => setLists({ ...lists, adminlist: e.target.value })}
                  placeholder="76561198000000001"
                  className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 p-3 font-mono-code text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-rose-300 mb-1.5">
                  bannedlist.txt
                </label>
                <textarea
                  rows={12}
                  value={lists.bannedlist}
                  onChange={(e) => setLists({ ...lists, bannedlist: e.target.value })}
                  placeholder="SteamID64 to ban"
                  className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 p-3 font-mono-code text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-emerald-300 mb-1.5">
                  permittedlist.txt (Whitelist)
                </label>
                <textarea
                  rows={12}
                  value={lists.permittedlist}
                  onChange={(e) => setLists({ ...lists, permittedlist: e.target.value })}
                  placeholder="Leave empty to allow all players with password"
                  className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 p-3 font-mono-code text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-emerald-400">{listMessage}</span>
              <button
                onClick={handleSaveLists}
                disabled={savingLists}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {savingLists ? 'Saving...' : 'Save Player Lists'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
