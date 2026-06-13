import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { logger } from './logger.js';
import { authRequired, requireAdmin, hashPassword } from './auth.js';

export const userRoutes = Router();
userRoutes.use(authRequired);

// ─── POST /api/users ────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255).optional(),
  role: z.enum(['admin', 'user']).default('user'),
});

userRoutes.post('/', requireAdmin, async (req, res) => {
  try {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }

    const { email, password, name, role } = body.data;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query<{
      id: string; email: string; name: string | null;
      role: string; auth_provider: string; created_at: string; updated_at: string;
    }>(
      `INSERT INTO users (email, name, password_hash, role, auth_provider)
       VALUES ($1, $2, $3, $4, 'email')
       RETURNING id, email, name, role, auth_provider, created_at, updated_at`,
      [email, name ?? null, passwordHash, role]
    );

    const u = rows[0];
    logger.info('user_created_by_admin', { userId: u.id, email, role });
    res.status(201).json({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      authProvider: u.auth_provider,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    });
  } catch (err) {
    logger.error('users_create', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── GET /api/users ────────────────────────────────────────────────────────────

userRoutes.get('/', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query<{
      id: string; email: string; name: string | null; role: string;
      auth_provider: string; created_at: string; updated_at: string;
    }>(
      `SELECT id, email, name, role, auth_provider, created_at, updated_at
       FROM users ORDER BY created_at`
    );

    res.json(rows.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      authProvider: u.auth_provider,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    })));
  } catch (err) {
    logger.error('users_list', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/users/:id ──────────────────────────────────────────────────────

const userPatchSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
});

userRoutes.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const body = userPatchSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }

    const { id } = req.params;
    const { role } = body.data;

    if (!role) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Fetch target user
    const { rows: target } = await pool.query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1', [id]
    );
    if (target.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Never allow modifying super_admin
    if (target[0].role === 'super_admin') {
      res.status(403).json({ error: 'Cannot modify the super admin' });
      return;
    }

    // Prevent demoting yourself
    if (id === req.user!.id && role === 'user') {
      res.status(400).json({ error: 'Cannot demote yourself' });
      return;
    }

    const { rows } = await pool.query<{
      id: string; email: string; name: string | null; role: string;
    }>(
      `UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, email, name, role`,
      [role, id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const u = rows[0];
    logger.info('user_role_updated', { userId: id, role });
    res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
    });
  } catch (err) {
    logger.error('users_patch', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── DELETE /api/users/:id ─────────────────────────────────────────────────────

userRoutes.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete yourself' });
      return;
    }

    const { rows: targetRow } = await pool.query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1', [id]
    );
    if (targetRow.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Never allow deleting super_admin
    if (targetRow[0].role === 'super_admin') {
      res.status(403).json({ error: 'Cannot delete the super admin' });
      return;
    }

    // Prevent deleting the last admin (-ish: allow if super_admin still exists)
    if (targetRow[0].role === 'admin') {
      const { rows: adminCount } = await pool.query<{ cnt: number }>(
        "SELECT COUNT(*)::int AS cnt FROM users WHERE role IN ('admin', 'super_admin') AND id != $1",
        [id]
      );
      if (adminCount[0].cnt === 0) {
        res.status(400).json({ error: 'Cannot delete the last admin' });
        return;
      }
    }

    // Cascade: set created_by to NULL for their resources
    await pool.query('UPDATE quizzes SET created_by = NULL WHERE created_by = $1', [id]);
    await pool.query('UPDATE quiz_groups SET created_by = NULL WHERE created_by = $1', [id]);
    await pool.query('UPDATE attempts SET created_by = NULL WHERE created_by = $1', [id]);

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    logger.info('user_deleted', { userId: id });
    res.status(204).send();
  } catch (err) {
    logger.error('users_delete', err);
    res.status(500).json({ error: 'Internal error' });
  }
});
