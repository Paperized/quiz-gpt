import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { authRequired, requireAdmin, isAdminUser } from './auth.js';
import { encryptValue, decryptValue, maskSecret } from './encryption.js';

export const providerRoutes = Router();
providerRoutes.use(authRequired);

const providerCreateSchema = z.object({
  label: z.string().min(1).max(255),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']),
  apiKey: z.string().min(1).max(1024),
  baseUrl: z.string().max(1024).optional(),
  isSystem: z.boolean().optional(),
});

const providerUpdateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  apiKey: z.string().min(1).max(1024).optional(),
  baseUrl: z.string().max(1024).optional(),
});

const accessSchema = z.object({ userId: z.string().uuid() });

function rowToJson(m: Record<string, unknown>, encryptionKey: string): Record<string, unknown> {
  const apiKey = encryptionKey ? decryptValue(m.api_key_encrypted as string, encryptionKey) : '';
  return {
    id: m.id, label: m.label, provider: m.provider, baseUrl: m.base_url ?? null,
    apiKeyEncrypted: m.api_key_encrypted, apiKeyMasked: apiKey ? maskSecret(apiKey) : '••••••••',
    createdBy: m.created_by, isSystem: m.is_system,
    assignedTo: (m.assigned_to as string[] | null),
    createdAt: m.created_at, updatedAt: m.updated_at,
  };
}

// ─── GET /api/providers ────────────────────────────────────────────────────────

providerRoutes.get('/', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const adm = isAdminUser(req);
    let query: string;
    let params: string[];
    if (adm) {
      query = `SELECT p.*, COALESCE(json_agg(pa.user_id) FILTER (WHERE pa.user_id IS NOT NULL), '[]'::json) AS assigned_to FROM providers p LEFT JOIN provider_access pa ON pa.provider_id = p.id WHERE (p.is_system = true) OR (p.is_system = false AND p.created_by = $1) GROUP BY p.id ORDER BY p.is_system DESC, p.created_at DESC`;
      params = [req.user.id];
    } else {
      query = `SELECT p.*, NULL::json AS assigned_to FROM providers p WHERE (p.is_system = true AND EXISTS (SELECT 1 FROM provider_access pa WHERE pa.provider_id = p.id AND pa.user_id = $1)) OR (p.is_system = false AND p.created_by = $1) ORDER BY p.is_system DESC, p.created_at DESC`;
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    const key = config.SETTINGS_ENCRYPTION_KEY ?? '';
    res.json(rows.map((r: Record<string, unknown>) => rowToJson(r, key)));
  } catch (err) { logger.error('providers_list', err); res.status(500).json({ error: 'Internal error' }); }
});

// ─── POST /api/providers ───────────────────────────────────────────────────────

providerRoutes.post('/', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const body = providerCreateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Invalid input', details: body.error.flatten() }); return; }
    const { label, provider, apiKey, baseUrl, isSystem } = body.data;
    const key = config.SETTINGS_ENCRYPTION_KEY;
    if (!key) { res.status(500).json({ error: 'Encryption not configured' }); return; }
    const adm = isAdminUser(req);
    const finalSystem = adm ? (isSystem ?? false) : false;
    const encrypted = encryptValue(apiKey, key);
    const { rows } = await pool.query<Record<string, unknown>>(
      `INSERT INTO providers (label, provider, api_key_encrypted, base_url, created_by, is_system) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [label, provider, encrypted, baseUrl ?? null, req.user.id, finalSystem]
    );
    await pool.query(`INSERT INTO provider_access (provider_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [rows[0].id, req.user.id]);
    logger.info('provider_created', { providerId: rows[0].id, userId: req.user.id });
    res.status(201).json(rowToJson(rows[0], key));
  } catch (err) { logger.error('providers_create', err); res.status(500).json({ error: 'Internal error' }); }
});

// ─── PATCH /api/providers/:id ──────────────────────────────────────────────────

providerRoutes.patch('/:id', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const { id } = req.params;
    const { rows: ex } = await pool.query<{ created_by: string; is_system: boolean }>('SELECT created_by, is_system FROM providers WHERE id = $1', [id]);
    if (ex.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    const adm = isAdminUser(req);
    if (!adm && ex[0].created_by !== req.user.id) { res.status(403).json({ error: 'Not authorized' }); return; }
    if (adm && ex[0].created_by !== req.user.id && !ex[0].is_system) { res.status(403).json({ error: 'Cannot edit private provider' }); return; }
    const body = providerUpdateSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Invalid input' }); return; }
    const updates: string[] = []; const vals: (string | null)[] = []; let i = 1;
    if (body.data.label !== undefined) { updates.push(`label = $${i++}`); vals.push(body.data.label); }
    if (body.data.provider !== undefined) { updates.push(`provider = $${i++}`); vals.push(body.data.provider); }
    if (body.data.baseUrl !== undefined) { updates.push(`base_url = $${i++}`); vals.push(body.data.baseUrl); }
    if (body.data.apiKey !== undefined) {
      const key = config.SETTINGS_ENCRYPTION_KEY; if (!key) { res.status(500).json({ error: 'Encryption not configured' }); return; }
      updates.push(`api_key_encrypted = $${i++}`); vals.push(encryptValue(body.data.apiKey, key));
    }
    if (updates.length === 0) { res.status(400).json({ error: 'No fields' }); return; }
    updates.push('updated_at = now()'); vals.push(id);
    await pool.query(`UPDATE providers SET ${updates.join(', ')} WHERE id = $${i}`, vals);
    logger.info('provider_updated', { providerId: id });
    res.json({ ok: true });
  } catch (err) { logger.error('providers_update', err); res.status(500).json({ error: 'Internal error' }); }
});

// ─── DELETE /api/providers/:id ─────────────────────────────────────────────────

providerRoutes.delete('/:id', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const { id } = req.params;
    const { rows: ex } = await pool.query<{ created_by: string; is_system: boolean }>('SELECT created_by, is_system FROM providers WHERE id = $1', [id]);
    if (ex.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    const adm = isAdminUser(req);
    if (!adm && ex[0].created_by !== req.user.id) { res.status(403).json({ error: 'Not authorized' }); return; }
    if (adm && ex[0].created_by !== req.user.id && !ex[0].is_system) { res.status(403).json({ error: 'Cannot delete private provider' }); return; }
    // Nullify references in models
    await pool.query('UPDATE models SET provider_id = NULL WHERE provider_id = $1', [id]);
    await pool.query('DELETE FROM providers WHERE id = $1', [id]);
    logger.info('provider_deleted', { providerId: id });
    res.status(204).send();
  } catch (err) { logger.error('providers_delete', err); res.status(500).json({ error: 'Internal error' }); }
});

// ─── POST /api/providers/:id/access ────────────────────────────────────────────

providerRoutes.post('/:id/access', requireAdmin, async (req, res) => {
  try {
    const body = accessSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Invalid input' }); return; }
    const { id } = req.params;
    const { rows: ex } = await pool.query<{ is_system: boolean }>('SELECT is_system FROM providers WHERE id = $1', [id]);
    if (ex.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    if (!ex[0].is_system) { res.status(400).json({ error: 'Only system providers' }); return; }
    const { rows: u } = await pool.query('SELECT id FROM users WHERE id = $1', [body.data.userId]);
    if (u.length === 0) { res.status(404).json({ error: 'User not found' }); return; }
    await pool.query('INSERT INTO provider_access (provider_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, body.data.userId]);
    logger.info('provider_access_granted', { providerId: id, userId: body.data.userId });
    res.status(201).json({ ok: true });
  } catch (err) { logger.error('providers_access_grant', err); res.status(500).json({ error: 'Internal error' }); }
});

// ─── DELETE /api/providers/:id/access/:userId ───────────────────────────────────

providerRoutes.delete('/:id/access/:userId', requireAdmin, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { rows: ex } = await pool.query<{ is_system: boolean }>('SELECT is_system FROM providers WHERE id = $1', [id]);
    if (ex.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    if (!ex[0].is_system) { res.status(400).json({ error: 'Only system providers' }); return; }
    await pool.query('DELETE FROM provider_access WHERE provider_id = $1 AND user_id = $2', [id, userId]);
    logger.info('provider_access_revoked', { providerId: id, userId });
    res.status(204).send();
  } catch (err) { logger.error('providers_access_revoke', err); res.status(500).json({ error: 'Internal error' }); }
});

// ─── POST /api/providers/test ───────────────────────────────────────────────────

const providerTestSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']),
  baseUrl: z.string().max(1024).optional(),
  apiKey: z.string().min(1).max(1024),
});

function normalizeBaseUrl(baseUrl: string | undefined, provider: string): string {
  const base = (baseUrl || '').replace(/\/$/, '');
  if (base) return base;
  if (provider === 'openai') return 'https://api.openai.com/v1';
  if (provider === 'anthropic') return 'https://api.anthropic.com/v1';
  return base;
}

providerRoutes.post('/test', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const body = providerTestSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Invalid input', details: body.error.flatten() }); return; }
    const { provider, baseUrl, apiKey } = body.data;
    const resolved = normalizeBaseUrl(baseUrl, provider);

    if (provider === 'anthropic') {
      const resp = await fetch(`${resolved}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': config.ANTHROPIC_VERSION,
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-latest',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }]
        })
      });
      if (resp.ok || resp.status === 400) {
        // 400 is ok for Anthropic — API is reachable, just model might be wrong
        return res.json({ ok: true });
      }
      const errText = await resp.text().catch(() => '');
      return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` });
    }

    // openai / openai_compatible
    const endpoint = resolved.endsWith('/v1') ? `${resolved}/models` : `${resolved}/v1/models`;
    const resp = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      }
    });
    if (resp.ok) return res.json({ ok: true });
    const errText = await resp.text().catch(() => '');
    return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('provider_test_error', { message: msg });
    res.json({ ok: false, error: msg.slice(0, 300) });
  }
});

// ─── POST /api/providers/:id/test ───────────────────────────────────────────────

providerRoutes.post('/:id/test', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const { id } = req.params;
    const { rows: ex } = await pool.query<{ provider: string; base_url: string | null; api_key_encrypted: string }>(
      'SELECT provider, base_url, api_key_encrypted FROM providers WHERE id = $1', [id]
    );
    if (ex.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    const { provider, base_url, api_key_encrypted } = ex[0];
    const key = config.SETTINGS_ENCRYPTION_KEY;
    const apiKey = key ? decryptValue(api_key_encrypted, key) : '';
    if (!apiKey) { res.json({ ok: false, error: 'Cannot decrypt API key' }); return; }

    const resolved = normalizeBaseUrl(base_url ?? undefined, provider);

    if (provider === 'anthropic') {
      const resp = await fetch(`${resolved}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': config.ANTHROPIC_VERSION,
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model: 'claude-3-5-sonnet-latest', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      });
      if (resp.ok || resp.status === 400) return res.json({ ok: true });
      const errText = await resp.text().catch(() => '');
      return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
    }

    const endpoint = resolved.endsWith('/v1') ? `${resolved}/models` : `${resolved}/v1/models`;
    const resp = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
    });
    if (resp.ok) return res.json({ ok: true });
    const errText = await resp.text().catch(() => '');
    return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/providers/:id/models ──────────────────────────────────────────────

providerRoutes.get('/:id/models', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const { id } = req.params;
    const { rows: ex } = await pool.query<{ provider: string; base_url: string | null; api_key_encrypted: string }>(
      'SELECT provider, base_url, api_key_encrypted FROM providers WHERE id = $1', [id]
    );
    if (ex.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    const { provider, base_url, api_key_encrypted } = ex[0];

    if (provider === 'anthropic') {
      return res.json({ models: [] });
    }

    const key = config.SETTINGS_ENCRYPTION_KEY;
    const apiKey = key ? decryptValue(api_key_encrypted, key) : '';
    if (!apiKey) { res.status(400).json({ error: 'Cannot decrypt API key' }); return; }

    const resolved = normalizeBaseUrl(base_url ?? undefined, provider);
    const endpoint = resolved.endsWith('/v1') ? `${resolved}/models` : `${resolved}/v1/models`;
    const resp = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn('provider_models_fetch_failed', { providerId: id, status: resp.status, message: errText.slice(0, 200) });
      return res.json({ models: [] });
    }
    const data = await resp.json() as { data?: Array<{ id: string }> };
    const models = (data.data ?? []).map((m) => m.id).filter(Boolean).sort();
    res.json({ models });
  } catch (err) {
    logger.warn('provider_models_fetch_error', { message: err instanceof Error ? err.message : String(err) });
    res.json({ models: [] });
  }
});
