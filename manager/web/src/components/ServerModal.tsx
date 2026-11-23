import { useEffect, useState, type FormEvent } from 'react';
import {
  X,
  Swords,
  Pickaxe,
  Hammer,
  Skull,
  Sliders,
  Server,
  Shield,
  HardDrive,
  Users,
  Wand2,
} from 'lucide-react';
import { api } from '../api';
import type { PlayerLists, ServerConfig, WorldModifiers } from '../types';

interface ServerModalProps {
  existing?: ServerConfig | null;
  suggestedPort: number;
  onClose: () => void;
  onSave: (payload: Partial<ServerConfig> & { startImmediately?: boolean }) => Promise<void>;
}

type ModalTab = 'general' | 'gameplay' | 'saves' | 'access';

const emptyModifiers: WorldModifiers = {
  preset: '',
  combat: '',
  deathPenalty: '',
  resources: '',
  raids: '',
  portals: '',
  noBuildCost: false,
  playerEvents: false,
  passiveMobs: false,
  noMap: false,
  fire: false,
  dungeonBuild: false,
};

const QUICK_TEMPLATES: {
  id: string;
  label: string;
  desc: string;
  icon: typeof Swords;
  modifiers: WorldModifiers;
}[] = [
  {
    id: 'main',
    label: 'Main Realm',
    desc: 'Balanced vanilla Valheim',
    icon: Swords,
    modifiers: { ...emptyModifiers },
  },
  {
    id: 'farm',
    label: 'Resource Farm',
    desc: '3x drops + ore through portals',
    icon: Pickaxe,
    modifiers: {
      ...emptyModifiers,
      resources: 'most',
      portals: 'casual',
      raids: 'less',
    },
  },
  {
    id: 'creative',
    label: 'Creative Build',
    desc: 'No build cost, passive mobs',
    icon: Hammer,
    modifiers: {
      ...emptyModifiers,
      preset: 'hammer',
      noBuildCost: true,
      passiveMobs: true,
      raids: 'none',
      dungeonBuild: true,
    },
  },
  {
    id: 'hardcore',
    label: 'Hardcore',
    desc: 'Hard combat, brutal death',
    icon: Skull,
    modifiers: {
      ...emptyModifiers,
      preset: 'hardcore',
      combat: 'hard',
      deathPenalty: 'hardcore',
      noMap: true,
      fire: true,
    },
  },
];

const WORLD_TOGGLES: {
  key: keyof Pick<
    WorldModifiers,
    'noBuildCost' | 'passiveMobs' | 'playerEvents' | 'noMap' | 'fire' | 'dungeonBuild'
  >;
  label: string;
  desc: string;
}[] = [
  {
    key: 'noBuildCost',
    label: 'No Build Cost (Hammer Mode)',
    desc: 'Build structures and furniture freely without consuming resources.',
  },
  {
    key: 'passiveMobs',
    label: 'Passive Enemies',
    desc: 'Creatures will not attack players unless provoked first.',
  },
  {
    key: 'playerEvents',
    label: 'Player-Based Raids',
    desc: 'Base raids scale to each individual player’s boss progression.',
  },
  {
    key: 'noMap',
    label: 'No Map (Immersive)',
    desc: 'Disables the minimap and world map for pure exploration.',
  },
  {
    key: 'fire',
    label: 'Fire Hazards (All Biomes)',
    desc: 'Ashlands-style fire spread enabled across all biomes.',
  },
  {
    key: 'dungeonBuild',
    label: 'Allow Dungeon Building',
    desc: 'Lets players place structures inside caves, crypts, and dungeons.',
  },
];

export function ServerModal({ existing, suggestedPort, onClose, onSave }: ServerModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('general');
  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [worldName, setWorldName] = useState(existing?.worldName || 'Midgard');
  const [password, setPassword] = useState(existing?.password || 'valheim123');
  const [port, setPort] = useState(existing?.port || suggestedPort);
  const [isPublic, setIsPublic] = useState(existing?.isPublic ?? false);
  const [crossplay, setCrossplay] = useState(existing?.crossplay ?? false);
  const [saveInterval, setSaveInterval] = useState(existing?.saveInterval ?? 1800);
  const [backupsCount, setBackupsCount] = useState(existing?.backupsCount ?? 4);
  const [backupShort, setBackupShort] = useState(existing?.backupShort ?? 7200);
  const [backupLong, setBackupLong] = useState(existing?.backupLong ?? 43200);
  const [updateOnStart, setUpdateOnStart] = useState(existing?.updateOnStart ?? true);
  const [autoStart, setAutoStart] = useState(existing?.autoStart ?? true);
  const [extraArgs, setExtraArgs] = useState(existing?.extraArgs || '');
  const [modifiers, setModifiers] = useState<WorldModifiers>(
    existing?.modifiers ? { ...emptyModifiers, ...existing.modifiers } : { ...emptyModifiers }
  );
  const [lists, setLists] = useState<PlayerLists>({
    adminlist: '',
    bannedlist: '',
    permittedlist: '',
  });
  const [listsDirty, setListsDirty] = useState(false);
  const [startImmediately, setStartImmediately] = useState(!existing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (existing?.id) {
      api
        .getPlayerLists(existing.id)
        .then(setLists)
        .catch(() => {});
    }
  }, [existing?.id]);

  const applyTemplate = (t: (typeof QUICK_TEMPLATES)[number]) => {
    setModifiers({ ...t.modifiers });
    if (!existing && !name) {
      setName(`POK ${t.label}`);
      setDescription(t.desc);
    }
  };

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setPassword(out);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({
        name,
        description,
        worldName,
        password,
        port: Number(port),
        isPublic,
        crossplay,
        saveInterval: Number(saveInterval),
        backupsCount: Number(backupsCount),
        backupShort: Number(backupShort),
        backupLong: Number(backupLong),
        updateOnStart,
        autoStart,
        modifiers,
        extraArgs,
        startImmediately,
      });
      if (existing?.id && listsDirty) {
        await api.savePlayerLists(existing.id, lists);
      }
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: ModalTab; label: string; icon: typeof Server; show?: boolean }[] = [
    { id: 'general', label: 'General & Network', icon: Server, show: true },
    { id: 'gameplay', label: 'In-Game World Rules', icon: Shield, show: true },
    { id: 'saves', label: 'Saves & Automation', icon: HardDrive, show: true },
    { id: 'access', label: 'Admins & Whitelist', icon: Users, show: Boolean(existing) },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#111622] border border-slate-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0d121d] border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                {existing ? `Configure "${existing.name}"` : 'Create New Valheim Realm'}
              </h2>
              <p className="text-[11px] text-slate-400">
                Adjust server identity, in-game Valheim modifiers, and backup rules from one place
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 px-6 pt-3 pb-2 bg-[#0d121d]/70 border-b border-slate-800/80 overflow-x-auto">
          {tabs
            .filter((t) => t.show)
            .map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition shrink-0 cursor-pointer ${
                    active
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/35'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {error && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-4 py-3 text-sm text-rose-300">
                {error}
              </div>
            )}

            {/* TAB 1: GENERAL & NETWORK */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    One-Click Realm Presets
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {QUICK_TEMPLATES.map((t) => {
                      const Icon = t.icon;
                      return (
                        <button
                          type="button"
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          className="text-left rounded-xl bg-[#0b0f18] hover:bg-amber-500/10 border border-slate-800 hover:border-amber-500/40 p-3 transition cursor-pointer"
                        >
                          <Icon className="w-4 h-4 text-amber-400 mb-1.5" />
                          <div className="text-xs font-semibold text-slate-200">{t.label}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                            {t.desc}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Server Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. POK Main Realm"
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      World Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={worldName}
                      onChange={(e) => setWorldName(e.target.value)}
                      placeholder="e.g. Midgard"
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Server Password * (min 5 chars)
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        required
                        minLength={5}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="flex-1 rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={generatePassword}
                        className="px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 cursor-pointer"
                        title="Generate random password"
                      >
                        <Wand2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      UDP Port (maps {port}–{Number(port) + 1}/udp)
                    </label>
                    <input
                      type="number"
                      required
                      min={1024}
                      max={65530}
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Description (shown on dashboard card)
                    </label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. 3x Resource farm world for ore & wood transfers"
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={crossplay}
                      onChange={(e) => setCrossplay(e.target.checked)}
                      className="accent-amber-500 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Enable Crossplay (PlayFab)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Allows Steam, Xbox, and PC Game Pass players to join via Join Code.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="accent-amber-500 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        List on Public Community Browser
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Keep unchecked for private direct-IP / Join Code access only.
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* TAB 2: IN-GAME WORLD RULES */}
            {activeTab === 'gameplay' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Difficulty Preset
                    </label>
                    <select
                      value={modifiers.preset}
                      onChange={(e) =>
                        setModifiers({
                          ...modifiers,
                          preset: e.target.value as WorldModifiers['preset'],
                        })
                      }
                      className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">Default (Custom)</option>
                      <option value="normal">Normal</option>
                      <option value="casual">Casual</option>
                      <option value="easy">Easy</option>
                      <option value="hard">Hard</option>
                      <option value="hardcore">Hardcore</option>
                      <option value="immersive">Immersive</option>
                      <option value="hammer">Hammer (Creative)</option>
                    </select>
                  </div>

                  <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Resource Multiplier
                    </label>
                    <select
                      value={modifiers.resources}
                      onChange={(e) =>
                        setModifiers({
                          ...modifiers,
                          resources: e.target.value as WorldModifiers['resources'],
                        })
                      }
                      className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">1x (Default)</option>
                      <option value="muchless">0.5x</option>
                      <option value="less">0.75x</option>
                      <option value="more">1.5x</option>
                      <option value="muchmore">2x</option>
                      <option value="most">3x (Max)</option>
                    </select>
                  </div>

                  <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Portal Rules
                    </label>
                    <select
                      value={modifiers.portals}
                      onChange={(e) =>
                        setModifiers({
                          ...modifiers,
                          portals: e.target.value as WorldModifiers['portals'],
                        })
                      }
                      className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">Default (No Metal/Ore)</option>
                      <option value="casual">Casual (Teleport All Items/Ore)</option>
                      <option value="hard">Hard (No Boss Portals)</option>
                      <option value="veryhard">Very Hard (No Portals)</option>
                    </select>
                  </div>

                  <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Combat Difficulty
                    </label>
                    <select
                      value={modifiers.combat}
                      onChange={(e) =>
                        setModifiers({
                          ...modifiers,
                          combat: e.target.value as WorldModifiers['combat'],
                        })
                      }
                      className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">Default (Normal)</option>
                      <option value="veryeasy">Very Easy</option>
                      <option value="easy">Easy</option>
                      <option value="hard">Hard</option>
                      <option value="veryhard">Very Hard</option>
                    </select>
                  </div>

                  <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Death Penalty
                    </label>
                    <select
                      value={modifiers.deathPenalty}
                      onChange={(e) =>
                        setModifiers({
                          ...modifiers,
                          deathPenalty: e.target.value as WorldModifiers['deathPenalty'],
                        })
                      }
                      className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">Default</option>
                      <option value="casual">Casual (Keep Equipped Gear)</option>
                      <option value="veryeasy">Very Easy (Less Skill Loss)</option>
                      <option value="easy">Easy</option>
                      <option value="hard">Hard (Lose All Items)</option>
                      <option value="hardcore">Hardcore (Lose Items & Skills)</option>
                    </select>
                  </div>

                  <div className="rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5">
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Base Raid Frequency
                    </label>
                    <select
                      value={modifiers.raids}
                      onChange={(e) =>
                        setModifiers({
                          ...modifiers,
                          raids: e.target.value as WorldModifiers['raids'],
                        })
                      }
                      className="w-full rounded-lg bg-[#121826] border border-slate-700 px-2.5 py-2 text-xs text-slate-100"
                    >
                      <option value="">Default</option>
                      <option value="none">None (Raids Disabled)</option>
                      <option value="muchless">Much Less</option>
                      <option value="less">Less</option>
                      <option value="more">More</option>
                      <option value="muchmore">Much More</option>
                    </select>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
                    Special In-Game World Keys
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {WORLD_TOGGLES.map((t) => (
                      <label
                        key={t.key}
                        className="flex items-start gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 hover:border-slate-700 p-3 cursor-pointer transition"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(modifiers[t.key])}
                          onChange={(e) =>
                            setModifiers({ ...modifiers, [t.key]: e.target.checked })
                          }
                          className="accent-amber-500 mt-0.5"
                        />
                        <div>
                          <div className="text-xs font-semibold text-slate-200">{t.label}</div>
                          <div className="text-[11px] text-slate-400 mt-0.5">{t.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: SAVES & AUTOMATION */}
            {activeTab === 'saves' && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      World Auto-Save Interval (seconds)
                    </label>
                    <input
                      type="number"
                      min={300}
                      value={saveInterval}
                      onChange={(e) => setSaveInterval(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Default: 1800s (30 minutes)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Valheim Internal Backup Count
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={backupsCount}
                      onChange={(e) => setBackupsCount(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      In addition to POK-Valheim scheduled `.tar.gz` backups
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      First Auto-Backup Interval (seconds)
                    </label>
                    <input
                      type="number"
                      min={600}
                      value={backupShort}
                      onChange={(e) => setBackupShort(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Default: 7200s (2 hours)</p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">
                      Subsequent Backup Interval (seconds)
                    </label>
                    <input
                      type="number"
                      min={1800}
                      value={backupLong}
                      onChange={(e) => setBackupLong(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">Default: 43200s (12 hours)</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={updateOnStart}
                      onChange={(e) => setUpdateOnStart(e.target.checked)}
                      className="accent-amber-500 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Check SteamCMD Update on Start
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Automatically validates & updates Valheim binaries when container boots.
                      </div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 rounded-xl bg-[#0b0f18] border border-slate-800 p-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoStart}
                      onChange={(e) => setAutoStart(e.target.checked)}
                      className="accent-amber-500 mt-0.5"
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">
                        Docker Auto-Restart (unless-stopped)
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Automatically starts this realm after a Linux host reboot or crash.
                      </div>
                    </div>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Extra Valheim CLI Arguments (advanced)
                  </label>
                  <input
                    type="text"
                    value={extraArgs}
                    onChange={(e) => setExtraArgs(e.target.value)}
                    placeholder="e.g. -instanceid 1"
                    className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 px-3.5 py-2 text-sm text-slate-100 font-mono-code"
                  />
                </div>
              </div>
            )}

            {/* TAB 4: ADMINS & WHITELIST */}
            {activeTab === 'access' && existing && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">
                  Add one SteamID64 (or PlayFab ID for Crossplay) per line. These files are read
                  live by Valheim.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-amber-300 mb-1.5">
                      Admins (adminlist.txt)
                    </label>
                    <textarea
                      rows={10}
                      value={lists.adminlist}
                      onChange={(e) => {
                        setLists({ ...lists, adminlist: e.target.value });
                        setListsDirty(true);
                      }}
                      placeholder="76561198000000001"
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 p-3 font-mono-code text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-rose-300 mb-1.5">
                      Banned (bannedlist.txt)
                    </label>
                    <textarea
                      rows={10}
                      value={lists.bannedlist}
                      onChange={(e) => {
                        setLists({ ...lists, bannedlist: e.target.value });
                        setListsDirty(true);
                      }}
                      placeholder="SteamID64 to ban"
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 p-3 font-mono-code text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-emerald-300 mb-1.5">
                      Whitelist (permittedlist.txt)
                    </label>
                    <textarea
                      rows={10}
                      value={lists.permittedlist}
                      onChange={(e) => {
                        setLists({ ...lists, permittedlist: e.target.value });
                        setListsDirty(true);
                      }}
                      placeholder="Leave blank to allow anyone with password"
                      className="w-full rounded-xl bg-[#0b0f18] border border-slate-700/80 p-3 font-mono-code text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 bg-[#0d121d] border-t border-slate-800">
            {!existing ? (
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={startImmediately}
                  onChange={(e) => setStartImmediately(e.target.checked)}
                  className="accent-amber-500"
                />
                <span>Start server immediately after creation</span>
              </label>
            ) : (
              <span className="text-xs text-slate-400">
                Changes apply automatically (gracefully restarts if running).
              </span>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 disabled:opacity-50 text-slate-950 font-semibold text-sm cursor-pointer"
              >
                {saving ? 'Applying...' : existing ? 'Save & Apply' : 'Create Realm'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
