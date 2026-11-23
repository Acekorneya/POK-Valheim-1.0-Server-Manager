import { Router } from 'express';
import multer from 'multer';
import { modService } from '../modService.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

export const modsRouter = Router();

modsRouter.get('/catalog', async (req, res) => {
  try {
    const result = await modService.searchCatalog({
      search: typeof req.query.search === 'string' ? req.query.search : '',
      sort: (req.query.sort as 'popular' | 'latest' | 'rating') || 'popular',
      category: typeof req.query.category === 'string' ? req.query.category : 'all',
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 24,
      forceRefresh: req.query.refresh === 'true',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

modsRouter.get('/server/:serverId', (req, res) => {
  try {
    res.json(modService.getServerModsState(req.params.serverId));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

modsRouter.put('/server/:serverId/enabled', (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    res.json(modService.setServerModsEnabled(req.params.serverId, Boolean(enabled)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

modsRouter.post('/server/:serverId/install', async (req, res) => {
  try {
    const { fullName, installDependencies } = req.body as {
      fullName: string;
      installDependencies?: boolean;
    };
    if (!fullName) {
      res.status(400).json({ error: 'fullName is required' });
      return;
    }
    const state = await modService.installThunderstoreMod(
      req.params.serverId,
      fullName,
      installDependencies !== false
    );
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

modsRouter.post('/server/:serverId/toggle', (req, res) => {
  try {
    const { fullName, enabled } = req.body as { fullName: string; enabled: boolean };
    res.json(modService.toggleMod(req.params.serverId, fullName, Boolean(enabled)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

modsRouter.delete('/server/:serverId/:fullName', (req, res) => {
  try {
    res.json(modService.uninstallMod(req.params.serverId, req.params.fullName));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

modsRouter.post('/server/:serverId/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No mod file uploaded' });
      return;
    }
    const state = await modService.uploadCustomMod(String(req.params.serverId), req.file);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

modsRouter.get('/server/:serverId/configs/:filename', (req, res) => {
  try {
    const content = modService.readConfigFile(
      String(req.params.serverId),
      String(req.params.filename)
    );
    res.json({ filename: String(req.params.filename), content });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

modsRouter.put('/server/:serverId/configs/:filename', (req, res) => {
  try {
    const { content } = req.body as { content: string };
    modService.writeConfigFile(
      String(req.params.serverId),
      String(req.params.filename),
      String(content ?? '')
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
