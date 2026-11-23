import { Router } from 'express';
import { config } from '../config.js';
import { signToken, verifyToken } from '../auth.js';

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  if (!config.auth.enabled) {
    res.json({
      authEnabled: false,
      authenticated: true,
      username: 'admin',
      isDefaultPassword: false,
      publicHost: config.publicHost,
    });
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = token ? verifyToken(token) : null;

  res.json({
    authEnabled: true,
    authenticated: Boolean(payload),
    username: payload?.username ?? null,
    isDefaultPassword: config.auth.password === 'pokvalheim',
    publicHost: config.publicHost,
  });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!config.auth.enabled) {
    res.json({ token: signToken('admin'), username: 'admin' });
    return;
  }

  if (username === config.auth.username && password === config.auth.password) {
    const token = signToken(username);
    res.json({ token, username });
    return;
  }

  res.status(401).json({ error: 'Invalid username or password' });
});
