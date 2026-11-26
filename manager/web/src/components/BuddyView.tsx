import { useEffect, useState } from 'react';
import { Bot, Sparkles, Search, Send, Save, Cpu, Cloud, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

interface BuddyConfigView {
  enabled: boolean;
  provider: 'openrouter' | 'lmstudio' | 'ollama' | 'custom';
  endpointUrl: string;
  hasApiKey: boolean;
  model: string;
  buddyName: string;
  personality: string;
}

interface FreeModel {
  id: string;
  name: string;
  contextLength: number;
}

export function BuddyView({ onNotify }: { onNotify: (msg: string, isError?: boolean) => void }) {
  const [cfg, setCfg] = useState<BuddyConfigView | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  const [freeModels, setFreeModels] = useState<FreeModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  const [testPrompt, setTestPrompt] = useState('Go chop 30 wood and put it in the Wood chest');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    reply: string;
    tasks: Array<{ action: string; amount?: number; chestLabel?: string }>;
    source: string;
    model?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    api
      .getBuddyConfig()
      .then((c) => setCfg(c))
      .catch((err) => onNotify((err as Error).message, true));
  }, [onNotify]);

  const applyPreset = (provider: BuddyConfigView['provider']) => {
    if (!cfg) return;
    if (provider === 'openrouter') {
      setCfg({
        ...cfg,
        provider,
        endpointUrl: 'https://openrouter.ai/api/v1/chat/completions',
        model: cfg.model.includes(':free') ? cfg.model : 'meta-llama/llama-3.3-70b-instruct:free',
      });
    } else if (provider === 'lmstudio') {
      setCfg({
        ...cfg,
        provider,
        endpointUrl: 'http://192.168.1.100:1234/v1/chat/completions',
        model: 'local-model',
      });
    } else if (provider === 'ollama') {
      setCfg({
        ...cfg,
        provider,
        endpointUrl: 'http://192.168.1.193:11434/v1/chat/completions',
        model: 'qwen2.5:7b',
      });
    } else {
      setCfg({ ...cfg, provider });
    }
  };

  const handleSave = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        enabled: cfg.enabled,
        provider: cfg.provider,
        endpointUrl: cfg.endpointUrl,
        model: cfg.model,
        buddyName: cfg.buddyName,
        personality: cfg.personality,
      };
      if (apiKeyInput.trim()) payload.apiKey = apiKeyInput.trim();
      const updated = await api.updateBuddyConfig(payload);
      setCfg(updated);
      setApiKeyInput('');
      onNotify('AI Buddy brain settings saved!');
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setSaving(false);
    }
  };

  const loadFreeModels = async () => {
    setLoadingModels(true);
    try {
      const res = await api.listOpenRouterFreeModels(modelSearch);
      setFreeModels(res.models);
      onNotify(`Loaded ${res.models.length} free OpenRouter models!`);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await api.testBuddyBrain(testPrompt);
      setTestResult(res);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setTesting(false);
    }
  };

  if (!cfg) {
    return <div className="text-slate-400 text-sm py-10 text-center">Loading AI Buddy settings...</div>;
  }

  const filteredModels = freeModels.filter(
    (m) =>
      !modelSearch.trim() ||
      m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
      m.name.toLowerCase().includes(modelSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Bot className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">AI Viking Buddy Brain</h2>
            <p className="text-xs text-slate-400">
              Connect OpenRouter (free or paid models), LM Studio, or Ollama to control your in-game Viking companion.
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-semibold text-xs transition cursor-pointer disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          <span>{saving ? 'Saving...' : 'Save Brain Config'}</span>
        </button>
      </div>

      {/* In-Game Controls Banner */}
      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs text-slate-300 space-y-1.5">
        <div className="font-semibold text-amber-300 flex items-center gap-2">
          <Sparkles className="w-4 h-4" /> How to Summon & Command Your AI Buddy In-Game
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-slate-300 pt-1">
          <div>
            • Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300">Alt + B</kbd> (or type <code className="text-amber-300">/buddy spawn</code> in chat) to summon <strong>{cfg.buddyName || 'Bjorn'}</strong>.
          </div>
          <div>
            • Type in normal chat: <code className="text-amber-300">buddy chop 30 wood and put it in the wood chest</code>
          </div>
          <div>
            • Other commands: <code className="text-amber-300">buddy follow me</code>, <code className="text-amber-300">buddy mine rocks</code>, <code className="text-amber-300">buddy repair</code>, <code className="text-amber-300">buddy guard</code>, <code className="text-amber-300">buddy stay</code>
          </div>
          <div>
            • Works even without an API key (built-in smart fallback), and gets full LLM reasoning once OpenRouter or LM Studio is configured!
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Provider & Model Config */}
        <div className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">LLM Provider</h3>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.enabled}
                onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
                className="accent-amber-500"
              />
              Enabled
            </label>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(
              [
                { id: 'openrouter', label: 'OpenRouter', icon: Cloud },
                { id: 'lmstudio', label: 'LM Studio', icon: Cpu },
                { id: 'ollama', label: 'Ollama', icon: Cpu },
                { id: 'custom', label: 'Custom', icon: Bot },
              ] as const
            ).map((p) => {
              const Icon = p.icon;
              const active = cfg.provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition cursor-pointer ${
                    active
                      ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">OpenAI-Compatible Chat Endpoint URL</label>
              <input
                value={cfg.endpointUrl}
                onChange={(e) => setCfg({ ...cfg, endpointUrl: e.target.value })}
                placeholder="https://openrouter.ai/api/v1/chat/completions"
                className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
              />
              {cfg.provider === 'lmstudio' && (
                <p className="text-[11px] text-slate-500 mt-1">
                  In LM Studio → Local Server → enable "Serve on Local Network" and put your PC's LAN IP (e.g. <code>http://192.168.1.X:1234/v1/chat/completions</code>).
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                API Key {cfg.hasApiKey && <span className="text-emerald-400">(Saved on server)</span>}
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={
                  cfg.provider === 'openrouter'
                    ? cfg.hasApiKey
                      ? '•••••••• (leave blank to keep saved key)'
                      : 'sk-or-v1-... (from openrouter.ai/keys)'
                    : 'Optional for LM Studio / Ollama'
                }
                className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Model ID</label>
              <input
                value={cfg.model}
                onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
                placeholder="meta-llama/llama-3.3-70b-instruct:free"
                className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Buddy Name</label>
                <input
                  value={cfg.buddyName}
                  onChange={(e) => setCfg({ ...cfg, buddyName: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">Personality</label>
                <input
                  value={cfg.personality}
                  onChange={(e) => setCfg({ ...cfg, personality: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Free OpenRouter Model Browser + Live Brain Tester */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-100">Browse Free OpenRouter Models</h3>
              <button
                onClick={loadFreeModels}
                disabled={loadingModels}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-medium transition cursor-pointer disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{loadingModels ? 'Loading...' : 'Fetch Free Models'}</span>
              </button>
            </div>
            <input
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Filter free models (e.g. llama, qwen, gemma, deepseek)..."
              className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
            />
            {filteredModels.length > 0 && (
              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                {filteredModels.slice(0, 40).map((m) => {
                  const selected = cfg.model === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() =>
                        setCfg({
                          ...cfg,
                          provider: 'openrouter',
                          endpointUrl: 'https://openrouter.ai/api/v1/chat/completions',
                          model: m.id,
                        })
                      }
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 transition cursor-pointer ${
                        selected
                          ? 'bg-amber-500/15 border border-amber-500/40 text-amber-200'
                          : 'bg-slate-900/50 hover:bg-slate-800/80 border border-transparent text-slate-300'
                      }`}
                    >
                      <div className="truncate">
                        <div className="font-medium truncate">{m.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{m.id}</div>
                      </div>
                      {selected && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#111622] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-100">Test AI Buddy Brain</h3>
            <div className="flex gap-2">
              <input
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
              />
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-medium transition cursor-pointer disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{testing ? 'Thinking...' : 'Test'}</span>
              </button>
            </div>

            {testResult && (
              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Source: <strong className={testResult.source === 'llm' ? 'text-emerald-400' : 'text-amber-400'}>{testResult.source.toUpperCase()}</strong>
                    {testResult.model ? ` (${testResult.model})` : ''}
                  </span>
                </div>
                <div className="text-amber-200 font-medium">"{testResult.reply}"</div>
                <div className="flex flex-wrap gap-1.5">
                  {testResult.tasks.map((t, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 text-[11px]"
                    >
                      {i + 1}. {t.action}
                      {t.amount ? ` (${t.amount})` : ''}
                      {t.chestLabel ? ` -> ${t.chestLabel}` : ''}
                    </span>
                  ))}
                </div>
                {testResult.error && (
                  <div className="text-[11px] text-rose-400">Note: {testResult.error}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
