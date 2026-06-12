import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let isEncrypted: typeof import('./settings.js').isEncrypted;
let maskSecret: typeof import('./settings.js').maskSecret;
let settingsSaveSchema: typeof import('./settings.js').settingsSaveSchema;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
  ({ isEncrypted, maskSecret, settingsSaveSchema } = await import('./settings.js'));
});

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.SETTINGS_ENCRYPTION_KEY = 'unit-test-secret';
});

describe('settings helpers', () => {
  it('masks secrets without exposing the whole value', () => {
    expect(maskSecret('abcdefghijk')).toBe('abc****');
    expect(maskSecret('')).toBe('');
  });

  it('recognizes encrypted sentinel values', () => {
    expect(isEncrypted('enc:iv:tag:ciphertext')).toBe(true);
    expect(isEncrypted('plain-text')).toBe(false);
  });
});

describe('settingsSaveSchema', () => {
  it('accepts zero to disable rate limits', () => {
    expect(settingsSaveSchema.parse({
      RATE_LIMIT_MAX_REQUESTS: 0,
      GENERATE_RATE_LIMIT_MAX_REQUESTS: 0
    })).toMatchObject({
      RATE_LIMIT_MAX_REQUESTS: 0,
      GENERATE_RATE_LIMIT_MAX_REQUESTS: 0
    });
  });

  it('rejects negative rate limits', () => {
    expect(() => settingsSaveSchema.parse({
      RATE_LIMIT_MAX_REQUESTS: -1
    })).toThrow();
  });
});

describe('settings persistence', () => {
  it('encrypts secret fields before writing to the database', async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });

    vi.doMock('./db.js', () => ({
      pool: { connect }
    }));

    const { saveSettings } = await import('./settings.js');

    await saveSettings({
      LLM_API_KEY: 'top-secret',
      LLM_MODEL: 'gpt-test'
    });

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    const llmApiCall = query.mock.calls.find((call) => call[1]?.[0] === 'LLM_API_KEY');
    expect(llmApiCall?.[1]?.[1]).toMatch(/^enc:/);
    const modelCall = query.mock.calls.find((call) => call[1]?.[0] === 'LLM_MODEL');
    expect(modelCall?.[1]?.[1]).toBe('gpt-test');
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('masks secret values when returning settings for display', async () => {
    const writeQuery = vi.fn().mockResolvedValue(undefined);
    const writeRelease = vi.fn();
    const writeConnect = vi.fn().mockResolvedValue({ query: writeQuery, release: writeRelease });

    vi.doMock('./db.js', () => ({
      pool: { connect: writeConnect }
    }));

    const { saveSettings } = await import('./settings.js');
    await saveSettings({ LLM_API_KEY: 'plain-secret' });

    const encryptedSecret = writeQuery.mock.calls.find((call) => call[1]?.[0] === 'LLM_API_KEY')?.[1]?.[1];

    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.SETTINGS_ENCRYPTION_KEY = 'unit-test-secret';

    const query = vi.fn().mockResolvedValue({
      rows: [
        { key: 'LLM_API_STYLE', value: 'openai_compatible' },
        { key: 'LLM_BASE_URL', value: 'https://example.test/v1' },
        { key: 'LLM_API_KEY', value: encryptedSecret },
        { key: 'LLM_MODEL', value: 'gpt-test' },
        { key: 'LLM_MAX_TOKENS', value: '1200' },
        { key: 'LLM_TEMPERATURE', value: '0.5' },
        { key: 'EMBEDDING_API_STYLE', value: 'same_as_llm' },
        { key: 'MAX_EMBEDDING_CANDIDATES', value: '220' },
        { key: 'EMBEDDING_BATCH_SIZE', value: '64' },
        { key: 'MAX_RETRIEVED_CHUNKS', value: '16' },
        { key: 'MAX_RETRIEVED_CHARS', value: '28000' },
        { key: 'RATE_LIMIT_MAX_REQUESTS', value: '0' },
        { key: 'GENERATE_RATE_LIMIT_MAX_REQUESTS', value: '0' }
      ]
    });

    vi.doMock('./db.js', () => ({
      pool: { query }
    }));

    const { getSettingsForDisplay } = await import('./settings.js');
    const display = await getSettingsForDisplay();

    expect(display).toMatchObject({
      LLM_BASE_URL: 'https://example.test/v1',
      LLM_MODEL: 'gpt-test',
      LLM_API_KEY_MASKED: 'plai****',
      RATE_LIMIT_MAX_REQUESTS: 0,
      GENERATE_RATE_LIMIT_MAX_REQUESTS: 0,
      ENCRYPTION_CONFIGURED: true
    });
  });

  it('seeds missing managed settings from config defaults', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const connect = vi.fn().mockResolvedValue({ query, release });

    vi.doMock('./db.js', () => ({
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        connect
      }
    }));

    const { initializeSettings } = await import('./settings.js');
    await initializeSettings();

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query.mock.calls.some((call) => call[0].includes('INSERT INTO app_settings'))).toBe(true);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalled();
  });
});
