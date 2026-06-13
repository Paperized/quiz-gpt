import { config } from './config.js';
import { logger } from './logger.js';
import type { EmbeddingConfig } from './types.js';

type RuntimeEmbeddingStyle = 'openai' | 'anthropic' | 'openai_compatible';

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number; }>;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function resolveEmbeddingStyle(): RuntimeEmbeddingStyle {
  if (config.EMBEDDING_API_STYLE === 'same_as_llm') {
    if (config.LLM_API_STYLE === 'openai') return 'openai';
    if (config.LLM_API_STYLE === 'openai_compatible') return 'openai_compatible';
    return 'anthropic';
  }
  return config.EMBEDDING_API_STYLE as RuntimeEmbeddingStyle;
}

function resolveEmbeddingModel(style: RuntimeEmbeddingStyle): string {
  if (config.EMBEDDING_MODEL?.trim()) return config.EMBEDDING_MODEL.trim();
  if (style === 'openai' || style === 'openai_compatible') return 'text-embedding-3-small';
  return 'voyage-3.5';
}

function resolveEmbeddingBaseUrl(): string {
  return normalizeBaseUrl(config.EMBEDDING_BASE_URL?.trim() || config.LLM_BASE_URL);
}

function resolveEmbeddingApiKey(): string {
  const key = config.EMBEDDING_API_KEY?.trim() || config.LLM_API_KEY;
  if (!key) {
    throw new Error('Embedding API key is missing. Set EMBEDDING_API_KEY or LLM_API_KEY.');
  }
  return key;
}

function buildEndpoint(style: RuntimeEmbeddingStyle, baseUrl: string): string {
  if (baseUrl.endsWith('/v1')) return `${baseUrl}/embeddings`;
  return `${baseUrl}/v1/embeddings`;
}

function buildHeaders(style: RuntimeEmbeddingStyle, apiKey: string, anthropicVersion?: string): Record<string, string> {
  if (style === 'anthropic') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': anthropicVersion || config.ANTHROPIC_VERSION,
      Authorization: `Bearer ${apiKey}`
    };
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

export function normalizeProvider(provider: string): RuntimeEmbeddingStyle {
  const lower = provider.toLowerCase();
  if (lower === 'anthropic') return 'anthropic';
  if (lower === 'openai') return 'openai';
  return 'openai_compatible';
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!denom) return 0;
  return dot / denom;
}

async function requestEmbeddingsDirect(
  values: string[],
  style: RuntimeEmbeddingStyle,
  model: string,
  baseUrl: string,
  apiKey: string,
  anthropicVersion?: string
): Promise<number[][]> {
  if (!values.length) return [];

  const endpoint = buildEndpoint(style, baseUrl);
  const started = Date.now();
  logger.info('embeddings.requested', {
    style,
    baseUrl,
    model,
    inputs: values.length
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(style, apiKey, anthropicVersion),
    body: JSON.stringify({
      model,
      input: values
    })
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    logger.warn('embeddings.failed_response', {
      style,
      model,
      status: response.status,
      message: payload.slice(0, 240)
    });
    throw new Error(`Embedding request failed (${response.status}). ${payload.slice(0, 400)}`);
  }

  const payload = await response.json() as EmbeddingResponse;
  const data = payload.data ?? [];
  if (data.length !== values.length) {
    throw new Error(`Embedding response length mismatch: expected ${values.length}, got ${data.length}`);
  }

  const vectors = data.map((item, idx) => {
    const vector = item.embedding;
    if (!Array.isArray(vector) || !vector.length || !vector.every((n) => Number.isFinite(n))) {
      throw new Error(`Invalid embedding vector for input index ${idx}`);
    }
    return vector;
  });

  logger.info('embeddings.completed', {
    style,
    model,
    inputs: values.length,
    dimensions: vectors[0]?.length ?? 0,
    durationMs: Date.now() - started
  });

  return vectors;
}

async function requestEmbeddings(values: string[]): Promise<number[][]> {
  const style = resolveEmbeddingStyle();
  const model = resolveEmbeddingModel(style);
  const baseUrl = resolveEmbeddingBaseUrl();
  const apiKey = resolveEmbeddingApiKey();
  return requestEmbeddingsDirect(values, style, model, baseUrl, apiKey);
}

export async function embedTexts(values: string[], embeddingConfig?: EmbeddingConfig): Promise<number[][]> {
  const out: number[][] = [];

  if (embeddingConfig) {
    const style = normalizeProvider(embeddingConfig.provider);
    const batchSize = embeddingConfig.batchSize ?? config.EMBEDDING_BATCH_SIZE;
    for (let i = 0; i < values.length; i += batchSize) {
      const slice = values.slice(i, i + batchSize);
      const vectors = await requestEmbeddingsDirect(
        slice, style, embeddingConfig.modelId,
        normalizeBaseUrl(embeddingConfig.baseUrl), embeddingConfig.apiKey
      );
      out.push(...vectors);
    }
    return out;
  }

  for (let i = 0; i < values.length; i += config.EMBEDDING_BATCH_SIZE) {
    const slice = values.slice(i, i + config.EMBEDDING_BATCH_SIZE);
    const vectors = await requestEmbeddings(slice);
    out.push(...vectors);
  }
  return out;
}

export function rankByEmbeddingSimilarity(
  queryEmbedding: number[],
  candidateEmbeddings: number[][]
): number[] {
  return candidateEmbeddings.map((embedding) => cosineSimilarity(queryEmbedding, embedding));
}
