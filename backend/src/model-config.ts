import { pool } from './db.js';
import {
  config,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_LLM_MAX_TOKENS,
  DEFAULT_LLM_TEMPERATURE,
  DEFAULT_MAX_EMBEDDING_CANDIDATES,
  DEFAULT_MAX_RETRIEVED_CHARS,
  DEFAULT_MAX_RETRIEVED_CHUNKS
} from './config.js';
import { decryptValue } from './encryption.js';
import type { LLMConfig, EmbeddingConfig } from './types.js';

const MODEL_SQL = `
  SELECT m.*,
    COALESCE(p.provider, m.provider) AS effective_provider,
    COALESCE(p.base_url, m.base_url) AS effective_base_url,
    CASE WHEN m.provider_id IS NOT NULL THEN p.api_key_encrypted ELSE m.api_key_encrypted END AS effective_api_key_encrypted
  FROM models m
  LEFT JOIN providers p ON m.provider_id = p.id
  WHERE m.id = $1 AND m.model_type = $2
    AND (m.is_system = true OR EXISTS(SELECT 1 FROM model_access ma WHERE ma.model_id = m.id AND ma.user_id = $3))
`;

async function resolveConfig(modelId: string, modelType: 'llm' | 'embedding', userId: string) {
  const { rows } = await pool.query(MODEL_SQL, [modelId, modelType, userId]);
  if (!rows.length) return null;
  const m = rows[0] as Record<string, unknown>;

  const encKey = config.SETTINGS_ENCRYPTION_KEY;
  const enc = m.effective_api_key_encrypted as string;
  const apiKey = enc && encKey ? decryptValue(enc, encKey) : '';

  return {
    provider: (m.effective_provider as string) || (m.provider as string),
    baseUrl: (m.effective_base_url as string) || '',
    apiKey,
    modelId: m.model_id as string,
    maxTokens: (m.max_tokens as number) ?? DEFAULT_LLM_MAX_TOKENS,
    temperature: (m.temperature as number) ?? DEFAULT_LLM_TEMPERATURE,
    maxCandidates: (m.max_embedding_candidates as number) ?? DEFAULT_MAX_EMBEDDING_CANDIDATES,
    maxRetrievedChunks: (m.max_retrieved_chunks as number) ?? DEFAULT_MAX_RETRIEVED_CHUNKS,
    maxRetrievedChars: (m.max_retrieved_chars as number) ?? DEFAULT_MAX_RETRIEVED_CHARS,
    batchSize: (m.embedding_batch_size as number) ?? DEFAULT_EMBEDDING_BATCH_SIZE,
  };
}

export async function resolveLLMConfig(modelId: string, userId: string): Promise<LLMConfig | null> {
  const r = await resolveConfig(modelId, 'llm', userId);
  if (!r) return null;
  return {
    provider: r.provider,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    modelId: r.modelId,
    maxTokens: r.maxTokens,
    temperature: r.temperature,
  };
}

export async function resolveEmbeddingConfig(modelId: string, userId: string): Promise<EmbeddingConfig | null> {
  const r = await resolveConfig(modelId, 'embedding', userId);
  if (!r) return null;
  return {
    provider: r.provider,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    modelId: r.modelId,
    maxCandidates: r.maxCandidates,
    maxRetrievedChunks: r.maxRetrievedChunks,
    maxRetrievedChars: r.maxRetrievedChars,
    batchSize: r.batchSize,
  };
}

export async function getDefaultLLMConfig(userId: string): Promise<LLMConfig | null> {
  const { rows } = await pool.query(
    `SELECT m.id FROM models m
     JOIN model_access ma ON ma.model_id = m.id
     WHERE ma.user_id = $1 AND ma.is_default = true AND m.model_type = 'llm'
     LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  return resolveLLMConfig(rows[0].id, userId);
}

export async function getDefaultEmbeddingConfig(userId: string): Promise<EmbeddingConfig | null> {
  const { rows } = await pool.query(
    `SELECT m.id FROM models m
     JOIN model_access ma ON ma.model_id = m.id
     WHERE ma.user_id = $1 AND ma.is_default = true AND m.model_type = 'embedding'
     LIMIT 1`,
    [userId]
  );
  if (!rows.length) return null;
  return resolveEmbeddingConfig(rows[0].id, userId);
}
