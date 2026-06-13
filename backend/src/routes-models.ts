import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { ANTHROPIC_API_VERSION, config } from './config.js';
import { logger } from './logger.js';
import { authRequired, requireAdmin, isAdminUser } from './auth.js';
import { encryptValue, decryptValue, maskSecret } from './encryption.js';

export const modelRoutes = Router();
modelRoutes.use(authRequired);

const modelCreateSchema = z.object({
  label: z.string().min(1).max(255),
  modelType: z.enum(['llm', 'embedding']).default('llm'),
  providerId: z.string().uuid().optional(),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  modelId: z.string().min(1).max(255),
  apiKey: z.string().min(1).max(1024).optional(),
  baseUrl: z.string().max(1024).optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxRetrievedChunks: z.coerce.number().int().positive().optional(),
  maxRetrievedChars: z.coerce.number().int().positive().optional(),
  maxEmbeddingCandidates: z.coerce.number().int().positive().optional(),
  embeddingBatchSize: z.coerce.number().int().positive().optional(),
  isSystem: z.boolean().optional(),
});

const modelUpdateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  modelId: z.string().min(1).max(255).optional(),
  apiKey: z.string().min(1).max(1024).optional(),
  baseUrl: z.string().max(1024).optional(),
  maxTokens: z.coerce.number().int().positive().optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).optional().nullable(),
  maxRetrievedChunks: z.coerce.number().int().positive().optional().nullable(),
  maxRetrievedChars: z.coerce.number().int().positive().optional().nullable(),
  maxEmbeddingCandidates: z.coerce.number().int().positive().optional().nullable(),
  embeddingBatchSize: z.coerce.number().int().positive().optional().nullable(),
  isSystem: z.boolean().optional(),
});

const modelAccessSchema = z.object({
  userId: z.string().uuid(),
});

async function canAccessModel(modelId: string, userId: string, isAdmin: boolean): Promise<boolean> {
  const { rows } = await pool.query<{
    created_by: string;
    is_system: boolean;
    has_access: boolean;
  }>(
    `SELECT m.created_by,
            m.is_system,
            EXISTS(
              SELECT 1
              FROM model_access ma
              WHERE ma.model_id = m.id AND ma.user_id = $2
            ) AS has_access
     FROM models m
     WHERE m.id = $1`,
    [modelId, userId]
  );

  if (rows.length === 0) {
    return false;
  }

  const model = rows[0];
  if (model.created_by === userId) {
    return true;
  }

  if (model.is_system) {
    return isAdmin || model.has_access;
  }

  return false;
}

function modelRowToJson(m: Record<string, unknown>, encryptionKey: string, isDefault: boolean): Record<string, unknown> {
  // If providerId is set, use JOINed provider fields; otherwise use model's own encrypted key
  const provKey = m.p_api_key_encrypted as string | undefined;
  const apiKey = provKey
    ? (encryptionKey ? decryptValue(provKey, encryptionKey) : '')
    : (encryptionKey ? decryptValue(m.api_key_encrypted as string, encryptionKey) : '');
  return {
    id: m.id,
    label: m.label,
    modelType: m.model_type,
    provider: (m.p_provider as string) || (m.provider as string),
    modelId: m.model_id,
    apiKeyEncrypted: provKey || (m.api_key_encrypted as string),
    apiKeyMasked: apiKey ? maskSecret(apiKey) : '••••••••',
    baseUrl: (m.p_base_url as string) || (m.base_url as string) || null,
    providerId: m.provider_id ?? null,
    maxTokens: m.max_tokens ?? null,
    temperature: m.temperature ?? null,
    maxRetrievedChunks: m.max_retrieved_chunks ?? null,
    maxRetrievedChars: m.max_retrieved_chars ?? null,
    maxEmbeddingCandidates: m.max_embedding_candidates ?? null,
    embeddingBatchSize: m.embedding_batch_size ?? null,
    createdBy: m.created_by,
    isSystem: m.is_system,
    isDefault,
    assignedTo: (m.assigned_to as string[] | null),
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

// ─── GET /api/models ───────────────────────────────────────────────────────────

modelRoutes.get('/', async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const adm = isAdminUser(req);
    let query: string;
    let params: string[];

    if (adm) {
      query = `
        SELECT m.*, p.provider AS p_provider, p.base_url AS p_base_url, p.api_key_encrypted AS p_api_key_encrypted,
          COALESCE(json_agg(ma.user_id) FILTER (WHERE ma.user_id IS NOT NULL), '[]'::json) AS assigned_to,
          EXISTS(SELECT 1 FROM model_access ma2 WHERE ma2.model_id = m.id AND ma2.user_id = $1 AND ma2.is_default = true) AS is_default
        FROM models m
        LEFT JOIN providers p ON p.id = m.provider_id
        LEFT JOIN model_access ma ON ma.model_id = m.id
        WHERE (m.is_system = true) OR (m.is_system = false AND m.created_by = $1)
        GROUP BY m.id, p.id
        ORDER BY m.model_type, m.is_system DESC, m.created_at DESC
      `;
      params = [req.user.id];
    } else {
      query = `
        SELECT m.*, p.provider AS p_provider, p.base_url AS p_base_url, p.api_key_encrypted AS p_api_key_encrypted, NULL::json AS assigned_to,
          EXISTS(SELECT 1 FROM model_access ma WHERE ma.model_id = m.id AND ma.user_id = $1 AND ma.is_default = true) AS is_default
        FROM models m
        LEFT JOIN providers p ON p.id = m.provider_id
        LEFT JOIN model_access ma ON ma.model_id = m.id AND ma.user_id = $1
        WHERE (m.is_system = true AND EXISTS (
          SELECT 1 FROM model_access ma2 WHERE ma2.model_id = m.id AND ma2.user_id = $1
        ))
        OR (m.is_system = false AND m.created_by = $1)
        ORDER BY m.model_type, m.is_system DESC, m.created_at DESC
      `;
      params = [req.user.id];
    }

    const { rows } = await pool.query(query, params);
    const encryptionKey = config.SETTINGS_ENCRYPTION_KEY ?? '';

    res.json(rows.map((m: Record<string, unknown>) =>
      modelRowToJson(m, encryptionKey, Boolean(m.is_default))
    ));
  } catch (err) {
    logger.error('models_list', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/models ──────────────────────────────────────────────────────────

modelRoutes.post('/', async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const body = modelCreateSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }

    const { label, modelType, providerId, provider, modelId, apiKey, baseUrl, maxTokens, temperature, maxRetrievedChunks, maxRetrievedChars, maxEmbeddingCandidates, embeddingBatchSize, isSystem } = body.data;
    const encryptionKey = config.SETTINGS_ENCRYPTION_KEY;
    if (!encryptionKey) {
      res.status(500).json({ error: 'Encryption not configured (SETTINGS_ENCRYPTION_KEY missing)' });
      return;
    }

    const adm = isAdminUser(req);
    const finalIsSystem = adm ? (isSystem ?? false) : false;

    // If providerId is set, use provider config; otherwise use inline config
    let encrypted: string | null = null;
    let resolvedProvider: string | null = null;
    let resolvedBaseUrl: string | null = null;

    if (providerId) {
      // Verify provider exists and user has access
      const { rows: provs } = await pool.query<{ provider: string; base_url: string | null; is_system: boolean }>(
        'SELECT provider, base_url, is_system FROM providers WHERE id = $1', [providerId]
      );
      if (provs.length === 0) { res.status(404).json({ error: 'Provider not found' }); return; }
      resolvedProvider = provs[0].provider;
      resolvedBaseUrl = provs[0].base_url;
      // Don't store apiKey on model - it comes from the provider at query time
    } else {
      if (!provider || !apiKey) { res.status(400).json({ error: 'provider and apiKey required in manual mode' }); return; }
      resolvedProvider = provider;
      resolvedBaseUrl = baseUrl ?? null;
      encrypted = encryptValue(apiKey, encryptionKey);
    }

    const { rows } = await pool.query<Record<string, unknown>>(
      `INSERT INTO models (label, model_type, provider, model_id, api_key_encrypted, base_url, provider_id, max_tokens, temperature, max_retrieved_chunks, max_retrieved_chars, max_embedding_candidates, embedding_batch_size, created_by, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [label, modelType, resolvedProvider, modelId, encrypted ?? '', resolvedBaseUrl, providerId ?? null, maxTokens ?? null, temperature ?? null, maxRetrievedChunks ?? null, maxRetrievedChars ?? null, maxEmbeddingCandidates ?? null, embeddingBatchSize ?? null, req.user.id, finalIsSystem]
    );

    const model = rows[0];

    await pool.query(
      `INSERT INTO model_access (model_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [model.id, req.user.id]
    );

    logger.info('model_created', { modelId: model.id, userId: req.user.id, modelType, isSystem: finalIsSystem });

    res.status(201).json(modelRowToJson(model, encryptionKey, false));
  } catch (err) {
    logger.error('models_create', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PATCH /api/models/:id ─────────────────────────────────────────────────────

modelRoutes.patch('/:id', async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const { rows: existing } = await pool.query<{ created_by: string; is_system: boolean }>(
      'SELECT created_by, is_system FROM models WHERE id = $1', [id]
    );
    if (existing.length === 0) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    const model = existing[0];
    const adm = isAdminUser(req);
    if (!adm && model.created_by !== req.user.id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    if (adm && model.created_by !== req.user.id && !model.is_system) {
      res.status(403).json({ error: "Cannot edit another user's private model" });
      return;
    }

    const body = modelUpdateSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }

    const updates: string[] = [];
    const values: (string | number | boolean | null)[] = [];
    let idx = 1;

    const set = (col: string, val: unknown) => { updates.push(`${col} = $${idx++}`); values.push(val as any); };

    if (body.data.label !== undefined) set('label', body.data.label);
    if (body.data.provider !== undefined) set('provider', body.data.provider);
    if (body.data.modelId !== undefined) set('model_id', body.data.modelId);
    if (body.data.baseUrl !== undefined) set('base_url', body.data.baseUrl);
    if (body.data.maxTokens !== undefined) set('max_tokens', body.data.maxTokens);
    if (body.data.temperature !== undefined) set('temperature', body.data.temperature);
    if (body.data.maxRetrievedChunks !== undefined) set('max_retrieved_chunks', body.data.maxRetrievedChunks);
    if (body.data.maxRetrievedChars !== undefined) set('max_retrieved_chars', body.data.maxRetrievedChars);
    if (body.data.maxEmbeddingCandidates !== undefined) set('max_embedding_candidates', body.data.maxEmbeddingCandidates);
    if (body.data.embeddingBatchSize !== undefined) set('embedding_batch_size', body.data.embeddingBatchSize);
    if (body.data.isSystem !== undefined && adm) set('is_system', body.data.isSystem);
    if (body.data.apiKey !== undefined) {
      const encryptionKey = config.SETTINGS_ENCRYPTION_KEY;
      if (!encryptionKey) {
        res.status(500).json({ error: 'Encryption not configured' });
        return;
      }
      set('api_key_encrypted', encryptValue(body.data.apiKey, encryptionKey));
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push('updated_at = now()');
    values.push(id);

    await pool.query(`UPDATE models SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    logger.info('model_updated', { modelId: id, userId: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    logger.error('models_update', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── DELETE /api/models/:id ────────────────────────────────────────────────────

modelRoutes.delete('/:id', async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const { rows: existing } = await pool.query<{ created_by: string; is_system: boolean }>(
      'SELECT created_by, is_system FROM models WHERE id = $1', [id]
    );
    if (existing.length === 0) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    const model = existing[0];
    const adm = isAdminUser(req);
    if (!adm && model.created_by !== req.user.id) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }
    if (adm && model.created_by !== req.user.id && !model.is_system) {
      res.status(403).json({ error: "Cannot delete another user's private model" });
      return;
    }

    await pool.query('DELETE FROM models WHERE id = $1', [id]);
    logger.info('model_deleted', { modelId: id, userId: req.user.id });
    res.status(204).send();
  } catch (err) {
    logger.error('models_delete', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── PUT /api/models/:id/default ───────────────────────────────────────────────

modelRoutes.put('/:id/default', async (req, res) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const allowed = await canAccessModel(id, req.user.id, isAdminUser(req));
    if (!allowed) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    // Get model type
    const { rows: models } = await pool.query<{ model_type: string }>(
      'SELECT model_type FROM models WHERE id = $1', [id]
    );
    if (models.length === 0) {
      res.status(404).json({ error: 'Model not found' });
      return;
    }

    const modelType = models[0].model_type;

    // Unset previous defaults of this type for this user
    await pool.query(
      `UPDATE model_access SET is_default = false
       WHERE user_id = $1 AND model_id IN (
         SELECT id FROM models WHERE model_type = $2
       )`,
      [req.user.id, modelType]
    );

    // Ensure access record exists and set as default
    await pool.query(
      `INSERT INTO model_access (model_id, user_id, is_default) VALUES ($1, $2, true)
       ON CONFLICT (model_id, user_id) DO UPDATE SET is_default = true`,
      [id, req.user.id]
    );

    logger.info('model_set_default', { modelId: id, userId: req.user.id, modelType });
    res.json({ ok: true });
  } catch (err) {
    logger.error('models_default', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/models/:id/access ───────────────────────────────────────────────

modelRoutes.post('/:id/access', requireAdmin, async (req, res) => {
  try {
    const body = modelAccessSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid input', details: body.error.flatten() });
      return;
    }
    const { id } = req.params;
    const { userId } = body.data;

    const { rows: existing } = await pool.query<{ is_system: boolean }>(
      'SELECT is_system FROM models WHERE id = $1', [id]
    );
    if (existing.length === 0) { res.status(404).json({ error: 'Model not found' }); return; }
    if (!existing[0].is_system) { res.status(400).json({ error: 'Can only grant access to system models' }); return; }

    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userRows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }

    await pool.query('INSERT INTO model_access (model_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]);
    logger.info('model_access_granted', { modelId: id, userId });
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error('models_access_grant', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── DELETE /api/models/:id/access/:userId ──────────────────────────────────────

modelRoutes.delete('/:id/access/:userId', requireAdmin, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { rows: existing } = await pool.query<{ is_system: boolean }>(
      'SELECT is_system FROM models WHERE id = $1', [id]
    );
    if (existing.length === 0) { res.status(404).json({ error: 'Model not found' }); return; }
    if (!existing[0].is_system) { res.status(400).json({ error: 'Can only revoke access to system models' }); return; }

    await pool.query('DELETE FROM model_access WHERE model_id = $1 AND user_id = $2', [id, userId]);
    logger.info('model_access_revoked', { modelId: id, userId });
    res.status(204).send();
  } catch (err) {
    logger.error('models_access_revoke', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ─── POST /api/models/test ──────────────────────────────────────────────────────

const modelTestSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  baseUrl: z.string().max(1024).optional(),
  apiKey: z.string().min(1).max(1024).optional(),
  providerId: z.string().uuid().optional(),
  modelId: z.string().min(1).max(255),
  modelType: z.enum(['llm', 'embedding']),
});

// ─── POST /api/models/:id/test ──────────────────────────────────────────────────

modelRoutes.post('/:id/test', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const { id } = req.params;
    const allowed = await canAccessModel(id, req.user.id, isAdminUser(req));
    if (!allowed) { res.status(403).json({ error: 'Not authorized' }); return; }

    const { rows } = await pool.query(
      `SELECT m.*,
        p.provider AS p_provider, p.base_url AS p_base_url, p.api_key_encrypted AS p_api_key_encrypted
       FROM models m
       LEFT JOIN providers p ON m.provider_id = p.id
       WHERE m.id = $1`, [id]
    );
    if (rows.length === 0) { res.status(404).json({ error: 'Not found' }); return; }
    const m = rows[0] as Record<string, unknown>;

    const effectiveProvider = m.provider_id
      ? (m.p_provider as string) || (m.provider as string)
      : (m.provider as string);
    const effectiveBaseUrl = m.provider_id
      ? ((m.p_base_url as string) || (m.base_url as string) || '')
      : ((m.base_url as string) || '');
    const encryptedKey = m.provider_id
      ? (m.p_api_key_encrypted as string)
      : (m.api_key_encrypted as string);

    const encKey = config.SETTINGS_ENCRYPTION_KEY;
    const apiKey = encKey ? decryptValue(encryptedKey, encKey) : '';
    if (!apiKey) { res.json({ ok: false, error: 'Cannot decrypt API key' }); return; }

    const modelId = m.model_id as string;
    const modelType = m.model_type as string;
    const resolved = effectiveBaseUrl.replace(/\/$/, '') || (effectiveProvider === 'openai' ? 'https://api.openai.com/v1' : effectiveProvider === 'anthropic' ? 'https://api.anthropic.com/v1' : '');

    if (modelType === 'llm') {
      if (effectiveProvider === 'anthropic') {
        const resp = await fetch(`${resolved}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
        });
        if (resp.ok || resp.status === 400) return res.json({ ok: true });
        const errText = await resp.text().catch(() => '');
        return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
      }
      const endpoint = resolved.endsWith('/v1') ? `${resolved}/chat/completions` : `${resolved}/v1/chat/completions`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
      });
      if (resp.ok || resp.status === 400) return res.json({ ok: true });
      const errText = await resp.text().catch(() => '');
      return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
    }

    // embedding
    const endpoint = resolved.endsWith('/v1') ? `${resolved}/embeddings` : `${resolved}/v1/embeddings`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(effectiveProvider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION } : {}),
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: modelId, input: ['test'] })
    });
    if (resp.ok) return res.json({ ok: true });
    const errText = await resp.text().catch(() => '');
    return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

modelRoutes.post('/test', async (req, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: 'Not authenticated' }); return; }
    const body = modelTestSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Invalid input', details: body.error.flatten() }); return; }
    let { provider, baseUrl, apiKey, modelId, modelType } = body.data;

    // If providerId is given, resolve config from DB
    if (body.data.providerId) {
      const { rows } = await pool.query<{ provider: string; base_url: string | null; api_key_encrypted: string }>(
        'SELECT provider, base_url, api_key_encrypted FROM providers WHERE id = $1', [body.data.providerId]
      );
      if (rows.length === 0) { res.status(404).json({ error: 'Provider not found' }); return; }
      provider = rows[0].provider as typeof provider;
      baseUrl = rows[0].base_url ?? undefined;
      const key = config.SETTINGS_ENCRYPTION_KEY;
      apiKey = key ? decryptValue(rows[0].api_key_encrypted, key) : '';
    }

    if (!provider || !apiKey) { res.status(400).json({ error: 'provider and apiKey are required' }); return; }
    const resolved = ((baseUrl || '').replace(/\/$/, '') || (provider === 'openai' ? 'https://api.openai.com/v1' : provider === 'anthropic' ? 'https://api.anthropic.com/v1' : ''));

    if (modelType === 'llm') {
      if (provider === 'anthropic') {
        const resp = await fetch(`${resolved}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_API_VERSION,
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({ model: modelId, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
        });
        if (resp.ok || resp.status === 400) return res.json({ ok: true });
        const errText = await resp.text().catch(() => '');
        return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` });
      }
      // openai / openai_compatible
      const endpoint = resolved.endsWith('/v1') ? `${resolved}/chat/completions` : `${resolved}/v1/chat/completions`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
      });
      if (resp.ok || resp.status === 400) return res.json({ ok: true });
      const errText = await resp.text().catch(() => '');
      return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` });
    }

    // embedding
    const endpoint = resolved.endsWith('/v1') ? `${resolved}/embeddings` : `${resolved}/v1/embeddings`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(provider === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION } : {}),
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model: modelId, input: ['test'] })
    });
    if (resp.ok) return res.json({ ok: true });
    const errText = await resp.text().catch(() => '');
    return res.json({ ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('model_test_error', { message: msg });
    res.json({ ok: false, error: msg.slice(0, 300) });
  }
});
