import { beforeAll, describe, expect, it, vi } from 'vitest';

let resolveLLMConfig: typeof import('./model-config.js').resolveLLMConfig;
let resolveEmbeddingConfig: typeof import('./model-config.js').resolveEmbeddingConfig;
let getDefaultLLMConfig: typeof import('./model-config.js').getDefaultLLMConfig;
let getDefaultEmbeddingConfig: typeof import('./model-config.js').getDefaultEmbeddingConfig;

const mockQuery = vi.fn();

vi.mock('./db.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) }
}));

vi.mock('./encryption.js', () => ({
  decryptValue: vi.fn().mockReturnValue('sk-test-api-key-12345'),
  encryptValue: vi.fn(),
  maskSecret: vi.fn().mockReturnValue('sk-••••••••')
}));

// Must be set before config.ts is loaded
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.SETTINGS_ENCRYPTION_KEY = 'test-encryption-key-32chars!!!!!!';

beforeAll(async () => {
  ({ resolveLLMConfig, resolveEmbeddingConfig, getDefaultLLMConfig, getDefaultEmbeddingConfig } = await import('./model-config.js'));
});

const sampleModel = {
  id: 'model-1',
  label: 'Test Model',
  model_type: 'llm',
  provider: 'openai',
  model_id: 'gpt-4o',
  api_key_encrypted: 'enc:abcdef:0123456789ab:deadbeef',
  base_url: 'https://api.openai.com/v1',
  provider_id: null,
  max_tokens: 4000,
  temperature: 0.5,
  max_retrieved_chunks: null,
  max_retrieved_chars: null,
  max_embedding_candidates: null,
  embedding_batch_size: null,
  created_by: 'user-1',
  is_system: false,
  created_at: '2024-01-01',
  updated_at: '2024-01-01'
};

describe('resolveLLMConfig', () => {
  it('returns LLMConfig for a valid model with provider join', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...sampleModel, effective_provider: 'openai', effective_base_url: 'https://api.openai.com/v1', effective_api_key_encrypted: 'enc:abcdef:0123456789ab:deadbeef' }]
    });

    const config = await resolveLLMConfig('model-1', 'user-1');

    expect(config).toBeTruthy();
    expect(config!.provider).toBe('openai');
    expect(config!.modelId).toBe('gpt-4o');
    expect(config!.maxTokens).toBe(4000);
    expect(config!.temperature).toBe(0.5);
    expect(config!.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('returns null for non-existent model', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const config = await resolveLLMConfig('bad-id', 'user-1');
    expect(config).toBeNull();
  });

  it('uses provider values when provider_id is set', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...sampleModel,
        provider_id: 'prov-1',
        provider: 'manual',
        base_url: null,
        api_key_encrypted: 'old-key',
        effective_provider: 'anthropic',
        effective_base_url: 'https://api.anthropic.com/v1',
        effective_api_key_encrypted: 'enc:abcdef:0123456789ab:deadbeef'
      }]
    });

    const config = await resolveLLMConfig('model-2', 'user-1');
    expect(config!.provider).toBe('anthropic');
    expect(config!.baseUrl).toBe('https://api.anthropic.com/v1');
  });
});

describe('resolveEmbeddingConfig', () => {
  const embModel = { ...sampleModel, model_type: 'embedding', model_id: 'text-embedding-3-small', max_embedding_candidates: 200, max_retrieved_chunks: 10, max_retrieved_chars: 20000, embedding_batch_size: 32 };

  it('returns EmbeddingConfig with retrieval fields', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...embModel, effective_provider: 'openai', effective_base_url: 'https://api.openai.com/v1', effective_api_key_encrypted: 'enc:abcdef:0123456789ab:deadbeef' }]
    });

    const config = await resolveEmbeddingConfig('emb-1', 'user-1');
    expect(config).toBeTruthy();
    expect(config!.provider).toBe('openai');
    expect(config!.modelId).toBe('text-embedding-3-small');
    expect(config!.maxCandidates).toBe(200);
    expect(config!.maxRetrievedChunks).toBe(10);
    expect(config!.maxRetrievedChars).toBe(20000);
    expect(config!.batchSize).toBe(32);
  });

  it('returns null for non-embedding model', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const config = await resolveEmbeddingConfig('bad-id', 'user-1');
    expect(config).toBeNull();
  });
});

describe('getDefaultLLMConfig', () => {
  it('returns the default LLM model config', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'model-1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...sampleModel, effective_provider: 'openai', effective_base_url: 'https://api.openai.com/v1', effective_api_key_encrypted: 'enc:abcdef:0123456789ab:deadbeef' }]
    });

    const config = await getDefaultLLMConfig('user-1');
    expect(config).toBeTruthy();
    expect(config!.modelId).toBe('gpt-4o');
  });

  it('returns null when no default is set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const config = await getDefaultLLMConfig('user-1');
    expect(config).toBeNull();
  });
});

describe('getDefaultEmbeddingConfig', () => {
  it('returns null when no embedding default', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const config = await getDefaultEmbeddingConfig('user-1');
    expect(config).toBeNull();
  });
});
