import { Router } from 'express';
import { buddyService } from '../buddyService.js';

export const buddyRouter = Router();
export const publicBuddyRouter = Router();

// Admin routes (protected)
buddyRouter.get('/config', (_req, res) => {
  res.json(buddyService.getPublicConfig());
});

buddyRouter.put('/config', (req, res) => {
  const body = req.body || {};
  const updated = buddyService.updateConfig({
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    provider: body.provider,
    endpointUrl: typeof body.endpointUrl === 'string' ? body.endpointUrl.trim() : undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    model: typeof body.model === 'string' ? body.model.trim() : undefined,
    buddyName: typeof body.buddyName === 'string' ? body.buddyName.trim() : undefined,
    personality: typeof body.personality === 'string' ? body.personality.trim() : undefined,
  });
  res.json(updated);
});

buddyRouter.get('/openrouter-free-models', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const models = await buddyService.listFreeOpenRouterModels(q);
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

buddyRouter.post('/test', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message : 'Chop 30 wood and put it in the Wood chest';
    const result = await buddyService.think({
      playerName: 'Admin',
      message,
      state: {
        hp: 400,
        maxHp: 400,
        axeDurability: 15,
        bagWood: 0,
        nearbyTrees: 8,
        nearbyRocks: 4,
        nearbyEnemies: 0,
        nearbyWorkbench: true,
        nearbyChests: ['Wood', 'Stone', 'Food'],
      },
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Public in-game mod endpoints (no admin token required, never exposes API key)
publicBuddyRouter.get('/info', (_req, res) => {
  const c = buddyService.getPublicConfig();
  res.json({ enabled: c.enabled, buddyName: c.buddyName, provider: c.provider, model: c.model });
});

publicBuddyRouter.post('/think', async (req, res) => {
  try {
    const result = await buddyService.think(req.body || { message: 'follow me' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
