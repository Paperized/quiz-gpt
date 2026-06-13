import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { signJWT, verifyJWT, setAuthCookie, clearAuthCookie, hashPassword, verifyPassword, authRequired, bootstrapFirstUser } from './auth.js';
import { getOidcLoginParams, handleOidcCallback, isOidcConfigured } from './auth-oidc.js';

export const authRoutes = Router();

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(128),
});

// ─── GET /api/auth/status ──────────────────────────────────────────────────────

authRoutes.get('/status', async (_req, res) => {
  try {
    const { rows } = await pool.query<{ cnt: number }>('SELECT COUNT(*)::int AS cnt FROM users');
    const hasUsers = rows[0].cnt > 0;
    res.json({
      hasUsers,
      oidcEnabled: isOidcConfigured(),
      emailEnabled: !config.DISABLE_EMAIL_REGISTER,
    });
  } catch (err) {
    logger.error('auth_status', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/auth/register ───────────────────────────────────────────────────

authRoutes.post('/register', async (req, res) => {
  try {
    if (config.DISABLE_EMAIL_REGISTER) {
      res.status(403).json({ error: 'Email registration is disabled' });
      return;
    }

    const body = registerSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }

    const { email, password, name } = body.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query<{
      id: string; sub: string | null; email: string; name: string | null;
      role: string; auth_provider: string; created_at: string; updated_at: string;
    }>(
      `INSERT INTO users (email, name, password_hash, role, auth_provider)
       VALUES ($1, $2, $3, 'user', 'email')
       RETURNING *`,
      [email, name ?? null, passwordHash]
    );

    const user = rows[0];
    await bootstrapFirstUser(user.id);

    // Re-fetch to get possibly-updated role
    const { rows: updated } = await pool.query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1', [user.id]
    );

    const token = signJWT({ sub: user.id, role: updated[0].role as 'super_admin' | 'admin' | 'user' });
    setAuthCookie(res, token);

    logger.info('user_registered', { userId: user.id, email });
    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: updated[0].role,
      authProvider: 'email',
    });
  } catch (err) {
    logger.error('auth_register', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/login ──────────────────────────────────────────────────────

authRoutes.post('/login', async (req, res) => {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }

    const { email, password } = body.data;

    const { rows } = await pool.query<{
      id: string; sub: string | null; email: string; name: string | null;
      role: string; password_hash: string | null; auth_provider: string;
    }>('SELECT * FROM users WHERE email = $1 AND auth_provider = \'email\'', [email]);

    if (rows.length === 0 || !rows[0].password_hash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.password_hash!);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signJWT({ sub: user.id, role: user.role as 'super_admin' | 'admin' | 'user' });
    setAuthCookie(res, token);

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      authProvider: 'email',
    });
  } catch (err) {
    logger.error('auth_login', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /api/auth/login/oidc ──────────────────────────────────────────────────

authRoutes.get('/login/oidc', async (_req, res) => {
  try {
    if (!isOidcConfigured()) {
      res.status(404).json({ error: 'OIDC not configured' });
      return;
    }

    const { url, state, nonce } = await getOidcLoginParams();

    // Store state + nonce in short-lived signed cookies for callback verification
    res.cookie('oidc_state', state, { httpOnly: true, secure: config.PUBLIC_URL.startsWith('https'), sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/' });
    res.cookie('oidc_nonce', nonce, { httpOnly: true, secure: config.PUBLIC_URL.startsWith('https'), sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/' });

    res.redirect(url);
  } catch (err) {
    logger.error('auth_oidc_login', err);
    res.status(500).json({ error: 'OIDC login failed' });
  }
});

// ─── GET /api/auth/callback/oidc ────────────────────────────────────────────────

authRoutes.get('/callback/oidc', async (req, res) => {
  try {
    if (!isOidcConfigured()) {
      res.status(404).json({ error: 'OIDC not configured' });
      return;
    }

    const callbackUrl = `${config.PUBLIC_URL}${req.originalUrl}`;
    const result = await handleOidcCallback(callbackUrl);

    // Upsert user
    const { rows } = await pool.query<{
      id: string; sub: string | null; email: string; name: string | null;
      role: string; auth_provider: string;
    }>(
      `INSERT INTO users (sub, email, name, role, auth_provider)
       VALUES ($1, $2, $3, $4, 'oidc')
       ON CONFLICT (sub) DO UPDATE SET email = $2, name = $3, updated_at = now()
       RETURNING *`,
      [result.sub, result.email, result.name, result.role]
    );

    const user = rows[0];
    await bootstrapFirstUser(user.id);

    // Re-fetch role (may have been promoted)
    const { rows: updated } = await pool.query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1', [user.id]
    );

    const token = signJWT({ sub: user.id, role: updated[0].role as 'super_admin' | 'admin' | 'user' });
    setAuthCookie(res, token);

    logger.info('oidc_login', { userId: user.id, email: user.email });
    res.redirect('/');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'OIDC callback failed';
    if (message === 'ACCESS_DENIED') {
      res.status(403).send(
        '<h1>Access Denied</h1><p>Your account is not authorized. Contact your admin to be assigned to <code>quiz_admin</code> or <code>quiz_user</code> group.</p>'
      );
      return;
    }
    logger.error('auth_oidc_callback', err);
    res.status(500).send('<h1>Login Failed</h1><p>An error occurred during authentication. Please try again.</p>');
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────────────────────────

authRoutes.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ─── GET /api/auth/me ──────────────────────────────────────────────────────────

authRoutes.get('/me', authRequired, async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { rows } = await pool.query<{
      id: string; sub: string | null; email: string; name: string | null;
      role: string; auth_provider: string; created_at: string; updated_at: string;
    }>('SELECT id, sub, email, name, role, auth_provider, created_at, updated_at FROM users WHERE id = $1', [req.user.id]);

    if (rows.length === 0) {
      clearAuthCookie(res);
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const u = rows[0];
    res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      authProvider: u.auth_provider,
      encryptionConfigured: Boolean(config.SETTINGS_ENCRYPTION_KEY),
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    });
  } catch (err) {
    logger.error('auth_me', err);
    res.status(500).json({ error: 'Internal error' });
  }
});
