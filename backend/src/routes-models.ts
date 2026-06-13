import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db.js';
import { config } from './config.js';
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
});

const modelAccessSchema = z.object({
  userId: z.string().uuid(),
});

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
