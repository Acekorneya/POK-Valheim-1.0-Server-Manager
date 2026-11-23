import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface AuthPayload {
  username: string;
}

export function signToken(username: string): string {
  return jwt.sign({ username }, config.auth.jwtSecret, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, config.auth.jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.auth.enabled) {
    next();
    return;
  }

  const header = req.headers.authorization;
  let token = '';
  if (header && header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired session token' });
    return;
  }

  next();
}
