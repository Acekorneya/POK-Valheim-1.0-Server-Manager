import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export type BuddyProvider = 'openrouter' | 'lmstudio' | 'ollama' | 'custom';

export interface BuddyConfig {
  enabled: boolean;
  provider: BuddyProvider;
  endpointUrl: string;
  apiKey: string;
  model: string;
  buddyName: string;
  personality: string;
}

export interface BuddyTask {
  action:
    | 'follow'
    | 'stay'
    | 'come'
    | 'harvest_wood'
    | 'harvest_stone'
    | 'deposit'
    | 'repair'
    | 'guard';
  amount?: number;
  chestLabel?: string;
}

export interface BuddyThinkRequest {
  playerName?: string;
  message: string;
  state?: {
    buddyPos?: string;
    hp?: number;
    maxHp?: number;
    axeDurability?: number;
    bagWood?: number;
    bagStone?: number;
    bagOre?: number;
    currentTask?: string;
    nearbyTrees?: number;
    nearbyRocks?: number;
    nearbyEnemies?: number;
    nearbyWorkbench?: boolean;
    nearbyChests?: string[];
  };
}

export interface BuddyThinkResponse {
  reply: string;
  tasks: BuddyTask[];
  source: 'llm' | 'fallback';
  model?: string;
  error?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
}

const DEFAULT_CONFIG: BuddyConfig = {
  enabled: true,
  provider: 'openrouter',
  endpointUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: '',
  model: 'meta-llama/llama-3.3-70b-instruct:free',
  buddyName: 'Bjorn',
  personality: 'Loyal, upbeat Viking companion who speaks in short, natural sentences.',
};

class BuddyService {
  private filePath = '';
  private cfg: BuddyConfig = { ...DEFAULT_CONFIG };
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private freeModelsCache: { fetchedAt: number; models: OpenRouterModel[] } | null = null;

  init(): void {
    this.filePath = path.join(config.dataDir, 'buddy-config.json');
    if (fs.existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<BuddyConfig>;
        this.cfg = { ...DEFAULT_CONFIG, ...parsed };
      } catch {
        this.cfg = { ...DEFAULT_CONFIG };
      }
    }
  }

  private save(): void {
    if (!this.filePath) this.init();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.cfg, null, 2), 'utf-8');
  }

  getConfig(): BuddyConfig {
    if (!this.filePath) this.init();
    return { ...this.cfg };
  }

  getPublicConfig() {
    const c = this.getConfig();
    return {
      enabled: c.enabled,
      provider: c.provider,
      endpointUrl: c.endpointUrl,
      hasApiKey: Boolean(c.apiKey && c.apiKey.trim().length > 0),
      model: c.model,
      buddyName: c.buddyName,
      personality: c.personality,
    };
  }

  updateConfig(patch: Partial<BuddyConfig>): ReturnType<BuddyService['getPublicConfig']> {
    if (!this.filePath) this.init();
    const cleanPatch: Partial<BuddyConfig> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) {
        (cleanPatch as Record<string, unknown>)[k] = v;
      }
    }
    this.cfg = {
      ...this.cfg,
      ...cleanPatch,
    };
    this.save();
    return this.getPublicConfig();
  }

  async listFreeOpenRouterModels(query = ''): Promise<OpenRouterModel[]> {
    const now = Date.now();
    if (!this.freeModelsCache || now - this.freeModelsCache.fetchedAt > 10 * 60 * 1000) {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`OpenRouter returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        data?: Array<{
          id?: string;
          name?: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
        }>;
      };
      const free = (data.data || [])
        .filter((m) => {
          if (!m.id) return false;
          if (m.id.endsWith(':free')) return true;
          const p = parseFloat(m.pricing?.prompt ?? '1');
          const c = parseFloat(m.pricing?.completion ?? '1');
          return p === 0 && c === 0;
        })
        .map((m) => ({
          id: m.id!,
          name: m.name || m.id!,
          contextLength: m.context_length || 0,
        }))
        .sort((a, b) => b.contextLength - a.contextLength);
      this.freeModelsCache = { fetchedAt: now, models: free };
    }

    const q = query.trim().toLowerCase();
    if (!q) return this.freeModelsCache.models;
    return this.freeModelsCache.models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }

  private fallbackPlan(req: BuddyThinkRequest): BuddyThinkResponse {
    const msg = (req.message || '').toLowerCase();
    const tasks: BuddyTask[] = [];
    const numMatch = msg.match(/\b(\d{1,3})\b/);
    const amount = numMatch ? Math.min(200, Math.max(5, parseInt(numMatch[1], 10))) : 25;

    const wantsRepair = /\b(repair|fix)\b/.test(msg);
    const wantsWood = /\b(wood|tree|trees|chop|lumber|log|logs)\b/.test(msg);
    const wantsStone = /\b(stone|rock|rocks|mine|mining|ore|copper|tin)\b/.test(msg);
    const wantsDeposit = /\b(deposit|drop|chest|box|store|put)\b/.test(msg);
    const wantsFollow = /\b(follow|come|with me|here)\b/.test(msg);
    const wantsStay = /\b(stay|stop|wait|hold|idle)\b/.test(msg);
    const wantsGuard = /\b(guard|fight|attack|protect|defend)\b/.test(msg);

    if (wantsRepair) tasks.push({ action: 'repair' });
    if (wantsWood) {
      tasks.push({ action: 'harvest_wood', amount });
      if (wantsDeposit) tasks.push({ action: 'deposit', chestLabel: 'Wood' });
    } else if (wantsStone) {
      tasks.push({ action: 'harvest_stone', amount });
      if (wantsDeposit) tasks.push({ action: 'deposit', chestLabel: 'Stone' });
    } else if (wantsDeposit) {
      tasks.push({ action: 'deposit' });
    }

    if (wantsGuard) tasks.push({ action: 'guard' });
    else if (wantsStay) tasks.push({ action: 'stay' });
    else if (wantsFollow || tasks.length === 0) tasks.push({ action: 'follow' });

    const summary = tasks.map((t) => t.action.replace('_', ' ')).join(' -> ');
    return {
      reply: `Aye! Starting: ${summary}.`,
      tasks,
      source: 'fallback',
    };
  }

  async think(req: BuddyThinkRequest): Promise<BuddyThinkResponse> {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      return { reply: `${cfg.buddyName} is currently resting.`, tasks: [{ action: 'stay' }], source: 'fallback' };
    }

    const needsKey = cfg.provider === 'openrouter';
    if (!cfg.endpointUrl || (needsKey && !cfg.apiKey.trim())) {
      return this.fallbackPlan(req);
    }

    const systemPrompt = [
      `You are ${cfg.buddyName}, an AI Viking companion playing Valheim with the player.`,
      `Personality: ${cfg.personality}`,
      `Respond ONLY with valid JSON (no markdown, no extra text) in this exact format:`,
      `{"reply":"short reply under 130 chars","tasks":[{"action":"...","amount":25,"chestLabel":"Wood"}]}`,
      `Allowed task actions ONLY:`,
      `- "follow" (follow the player)`,
      `- "come" (run to the player now)`,
      `- "stay" (stop and wait here)`,
      `- "guard" (guard nearby area and fight enemies)`,
      `- "repair" (walk to nearest Workbench/Forge and repair axe/pickaxe)`,
      `- "harvest_wood" (chop trees and collect wood; optional "amount" 5-150)`,
      `- "harvest_stone" (mine rocks/ore and collect stone/ore; optional "amount" 5-150)`,
      `- "deposit" (put gathered wood/stone/ore into a nearby chest; optional "chestLabel" like "Wood", "Stone", "Ore")`,
      `Smart rules: If axeDurability < 20 and player asks to chop/mine, put {"action":"repair"} first. If player asks to chop wood and put it in a box, queue harvest_wood then deposit.`,
    ].join('\n');

    const userContent = JSON.stringify({
      player: req.playerName || 'Viking',
      message: req.message,
      worldState: req.state || {},
    });

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.history.slice(-6),
      { role: 'user', content: userContent },
    ];

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (cfg.apiKey.trim()) {
        headers['Authorization'] = `Bearer ${cfg.apiKey.trim()}`;
      }
      if (cfg.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/Acekorneya/POK-Valheim-1.0-Server-Manager';
        headers['X-Title'] = 'POK-Valheim AI Buddy';
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(cfg.endpointUrl, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature: 0.3,
          max_tokens: 1024,
        }),
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        const fb = this.fallbackPlan(req);
        return { ...fb, error: `LLM HTTP ${res.status}: ${errText.slice(0, 160)}` };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const rawContent = (data.choices?.[0]?.message?.content || '').trim();
      const cleaned = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      const startIdx = cleaned.indexOf('{');
      const endIdx = cleaned.lastIndexOf('}');
      const jsonStr = startIdx >= 0 && endIdx > startIdx ? cleaned.slice(startIdx, endIdx + 1) : cleaned;
      const parsed = JSON.parse(jsonStr) as { reply?: string; tasks?: BuddyTask[] };

      const allowed = new Set([
        'follow',
        'stay',
        'come',
        'harvest_wood',
        'harvest_stone',
        'deposit',
        'repair',
        'guard',
      ]);
      const validTasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
        .filter((t) => t && typeof t.action === 'string' && allowed.has(t.action))
        .slice(0, 6);

      const reply = (parsed.reply || `On it!`).toString().slice(0, 160);
      this.history.push({ role: 'user', content: req.message });
      this.history.push({ role: 'assistant', content: JSON.stringify({ reply, tasks: validTasks }) });
      if (this.history.length > 12) this.history = this.history.slice(-12);

      return {
        reply,
        tasks: validTasks.length > 0 ? validTasks : this.fallbackPlan(req).tasks,
        source: 'llm',
        model: cfg.model,
      };
    } catch (err) {
      const fb = this.fallbackPlan(req);
      return { ...fb, error: (err as Error).message };
    }
  }
}

export const buddyService = new BuddyService();
