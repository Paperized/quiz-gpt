import { randomBytes } from 'node:crypto';
import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

const BCRYPT_ROUNDS = 12;

// ─── JWT ───────────────────────────────────────────────────────────────────────

let jwtSecret: string | null = null;

function getJwtSecret(): string {
  if (jwtSecret) return jwtSecret;
  if (config.JWT_SECRET) {
    jwtSecret = config.JWT_SECRET;
  } else {
    jwtSecret = randomBytes(64).toString('hex');
    logger.info('jwt_secret_generated');
  }
  return jwtSecret;
}

export interface JwtPayload {
  sub: string;
  role: 'super_admin' | 'admin' | 'user';
}

export function signJWT(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: config.JWT_EXPIRY as any });
}

export function verifyJWT(token: string): JwtPayload {
  return jwt.verify(token, getJwtSecret()) as JwtPayload;
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie('quizgpt_auth', token, {
    httpOnly: true,
    secure: config.PUBLIC_URL.startsWith('https'),
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie('quizgpt_auth', { path: '/' });
}

// ─── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── Auth Middleware ────────────────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string | null;
        role: 'super_admin' | 'admin' | 'user';
      };
    }
  }
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.quizgpt_auth;
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const payload = verifyJWT(token);
    req.user = {
      id: payload.sub,
      email: '',
      name: null,
      role: payload.role,
    };
    next();
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ error: 'Session expired' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function isAdminUser(req: Request): boolean {
  return req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

// ─── Bootstrap first user as super_admin ────────────────────────────────────────

export async function bootstrapFirstUser(userId: string): Promise<void> {
  const { rows } = await pool.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM users');
  if (rows[0].cnt !== 1) return;

  await pool.query("UPDATE users SET role = 'super_admin' WHERE id = $1", [userId]);
  logger.info('super_admin_promoted', { userId });
}
