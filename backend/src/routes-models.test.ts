import express from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const encryptValueMock = vi.fn((value: string) => `enc:${value}`);
const decryptValueMock = vi.fn(() => 'plain-secret');
const maskSecretMock = vi.fn(() => '••••••••');

const configMock = {
  SETTINGS_ENCRYPTION_KEY: 'enc-key'
};

vi.mock('./db.js', () => ({
  pool: {
    query: queryMock
  }
}));

vi.mock('./config.js', () => ({
  config: configMock,
  ANTHROPIC_API_VERSION: '2023-06-01'
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

vi.mock('./encryption.js', () => ({
  encryptValue: encryptValueMock,
  decryptValue: decryptValueMock,
  maskSecret: maskSecretMock
}));

vi.mock('./auth.js', () => ({
  authRequired: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = req.header('x-user-id');
    const role = (req.header('x-user-role') ?? 'user') as 'super_admin' | 'admin' | 'user';
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    req.user = {
      id: userId,
      email: `${userId}@example.com`,
      name: null,
      role
    };
    next();
  },
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'super_admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  },
  isAdminUser: (req: express.Request) => req.user?.role === 'admin' || req.user?.role === 'super_admin'
}));

const validateBaseUrlForSSRFMock = vi.fn().mockResolvedValue({ safe: true });
const secureFetchMock = vi.fn((input: RequestInfo, init?: RequestInit) => {
  return fetch(input, { ...init, redirect: 'error' });
});

vi.mock('./ip-check.js', () => ({
  validateBaseUrlForSSRF: validateBaseUrlForSSRFMock,
  secureFetch: secureFetchMock,
}));

let modelRoutes: typeof import('./routes-models.js').modelRoutes;

type MockResponse = {
  statusCode: number;
  headersSent: boolean;
  locals: Record<string, unknown>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload?: unknown) => MockResponse;
  end: (payload?: unknown) => MockResponse;
};

beforeAll(async () => {
  ({ modelRoutes } = await import('./routes-models.js'));
});

beforeEach(() => {
  queryMock.mockReset();
  encryptValueMock.mockClear();
  decryptValueMock.mockClear();
  maskSecretMock.mockClear();
  configMock.SETTINGS_ENCRYPTION_KEY = 'enc-key';
  vi.unstubAllGlobals();
});

async function request(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown }
) {
  const headers = Object.fromEntries(
    Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  const req = {
    method: init?.method ?? 'GET',
    url: path,
    originalUrl: path,
    path,
    headers,
    body: init?.body,
    params: {},
    query: {},
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  } as express.Request;

  return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const res: MockResponse = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload?: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload ?? null });
        return this;
      },
      end(payload?: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload ?? null });
        return this;
      }
    };

    (modelRoutes as unknown as { handle: (req: express.Request, res: express.Response, next: (error?: unknown) => void) => void }).handle(
      req,
      res as unknown as express.Response,
      (error: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        if (!res.headersSent) {
          resolve({ status: 404, body: null });
        }
      }
    );
  });
}

describe('modelRoutes', () => {
  it('lists only accessible system models for a non-admin user', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'model-1',
        label: 'Assigned system model',
        model_type: 'llm',
        provider: 'openai',
        p_provider: null,
        model_id: 'gpt-4o-mini',
        api_key_encrypted: 'ciphertext',
        p_api_key_encrypted: null,
        base_url: null,
        p_base_url: null,
        provider_id: null,
        max_tokens: null,
        temperature: null,
        max_retrieved_chunks: null,
        max_retrieved_chars: null,
        max_embedding_candidates: null,
        embedding_batch_size: null,
        created_by: 'owner-1',
        is_system: true,
        is_default: true,
        assigned_to: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      }]
    });

    const response = await request('/', {
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(200);
    expect(queryMock.mock.calls[0][0]).toContain('WHERE (m.is_system = true AND EXISTS');
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'model-1',
        isSystem: true,
        isDefault: true
      })
    ]);
  });

  it('rejects manual model creation without provider and apiKey', async () => {
    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'Manual model',
        modelId: 'gpt-4o-mini'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'provider and apiKey required in manual mode' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('creates a private model for non-admin users even if isSystem is requested', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'model-1',
          label: 'My model',
          model_type: 'llm',
          provider: 'openai',
          model_id: 'gpt-4o-mini',
          api_key_encrypted: 'ciphertext',
          base_url: null,
          provider_id: null,
          max_tokens: null,
          temperature: null,
          max_retrieved_chunks: null,
          max_retrieved_chars: null,
          max_embedding_candidates: null,
          embedding_batch_size: null,
          created_by: 'user-1',
          is_system: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z'
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'My model',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        apiKey: 'sk-test',
        isSystem: true
      }
    });

    expect(response.status).toBe(201);
    expect(encryptValueMock).toHaveBeenCalledWith('sk-test', 'enc-key');
    expect(queryMock.mock.calls[0][1][14]).toBe(false);
    expect(response.body).toMatchObject({
      id: 'model-1',
      isSystem: false,
      provider: 'openai'
    });
  });

  it('prevents admins from editing another user private model', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false
      }]
    });

    const response = await request('/model-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        label: 'Updated label'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Cannot edit another user's private model" });
  });

  it('grants access only to system models', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        is_system: false
      }]
    });

    const response = await request('/model-1/access', {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        userId: '00000000-0000-4000-8000-000000000000'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Can only grant access to system models' });
  });

  it('prevents non-owners from deleting a private model', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false
      }]
    });

    const response = await request('/model-1', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Not authorized' });
  });

  it('sets a model as default when the user can access it', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'user-1',
          is_system: false,
          has_access: true
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          model_type: 'llm'
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/model-1/default', {
      method: 'PUT',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(queryMock.mock.calls[2][0]).toContain('UPDATE model_access SET is_default = false');
    expect(queryMock.mock.calls[3][0]).toContain('INSERT INTO model_access');
  });

  it('blocks non-admin from creating manual model with private IP baseUrl', async () => {
    validateBaseUrlForSSRFMock.mockResolvedValueOnce({ safe: false, reason: 'Cannot use private/internal IP addresses' });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'Manual model',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        apiKey: 'sk-test',
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot use private/internal IP addresses' });
  });

  it('allows admin to create manual model with private IP baseUrl', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'model-1',
          label: 'My model',
          model_type: 'llm',
          provider: 'openai',
          model_id: 'gpt-4o-mini',
          api_key_encrypted: 'ciphertext',
          base_url: 'https://10.0.0.1/v1',
          provider_id: null,
          max_tokens: null,
          temperature: null,
          max_retrieved_chunks: null,
          max_retrieved_chars: null,
          max_embedding_candidates: null,
          embedding_batch_size: null,
          created_by: 'admin-1',
          is_system: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z'
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        label: 'Manual model',
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        apiKey: 'sk-test',
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(201);
  });

  it('blocks non-admin from creating provider-backed model with private provider baseUrl', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        provider: 'openai',
        base_url: 'https://10.0.0.1/v1',
        is_system: false
      }]
    });
    validateBaseUrlForSSRFMock.mockResolvedValueOnce({ safe: false, reason: 'Cannot use private/internal IP addresses' });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'Provider-backed',
        modelId: 'gpt-4o-mini',
        providerId: '00000000-0000-4000-8000-000000000000'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot use private/internal IP addresses' });
  });

  it('allows non-admin to create provider-backed model with system provider baseUrl', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          provider: 'openai',
          base_url: 'https://10.0.0.1/v1',
          is_system: true
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'model-1',
          label: 'My model',
          model_type: 'llm',
          provider: 'openai',
          model_id: 'gpt-4o-mini',
          api_key_encrypted: '',
          base_url: 'https://10.0.0.1/v1',
          provider_id: '00000000-0000-4000-8000-000000000000',
          max_tokens: null,
          temperature: null,
          max_retrieved_chunks: null,
          max_retrieved_chars: null,
          max_embedding_candidates: null,
          embedding_batch_size: null,
          created_by: 'user-1',
          is_system: false,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z'
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'Provider-backed',
        modelId: 'gpt-4o-mini',
        providerId: '00000000-0000-4000-8000-000000000000'
      }
    });

    expect(response.status).toBe(201);
    expect(validateBaseUrlForSSRFMock).not.toHaveBeenCalled();
  });

  it('blocks non-admin from updating model baseUrl to private IP', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'user-1',
        is_system: false,
        provider_id: null,
        provider_is_system: null
      }]
    });
    validateBaseUrlForSSRFMock.mockResolvedValueOnce({ safe: false, reason: 'Cannot use private/internal IP addresses' });

    const response = await request('/model-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        baseUrl: 'https://192.168.1.1/v1'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot use private/internal IP addresses' });
  });

  it('skips SSRF check when updating model backed by system provider', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'user-1',
          is_system: false,
          provider_id: 'prov-1',
          provider_is_system: true
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/model-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(validateBaseUrlForSSRFMock).not.toHaveBeenCalled();
  });

  it('blocks non-admin from testing with private baseUrl in ad-hoc test endpoint', async () => {
    validateBaseUrlForSSRFMock.mockResolvedValueOnce({ safe: false, reason: 'Cannot use private/internal IP addresses' });

    const response = await request('/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        provider: 'openai',
        apiKey: 'sk-test',
        modelId: 'gpt-4o-mini',
        modelType: 'llm',
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot use private/internal IP addresses' });
  });

  it('uses secureFetch with redirect:error in model test endpoint', async () => {
    secureFetchMock.mockClear();
    const mockResponse = { ok: true, status: 200, text: async () => '' } as unknown as Response;
    secureFetchMock.mockResolvedValueOnce(mockResponse);

    queryMock.mockResolvedValueOnce({
      rows: [{
        provider: 'openai',
        base_url: 'https://proxy.example/v1',
        api_key_encrypted: 'ciphertext',
        is_system: false
      }]
    });

    const response = await request('/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        providerId: '00000000-0000-4000-8000-000000000000',
        modelId: 'gpt-4o-mini',
        modelType: 'llm'
      }
    });

    expect(response.status).toBe(200);
    expect(secureFetchMock).toHaveBeenCalled();
  });

  it('tests a provider-backed model test through the real route', async () => {
    secureFetchMock.mockClear();
    const mockResponse = { ok: true, status: 200, text: async () => '' } as unknown as Response;
    secureFetchMock.mockResolvedValueOnce(mockResponse);

    queryMock.mockResolvedValueOnce({
      rows: [{
        provider: 'openai',
        base_url: 'https://proxy.example/v1',
        api_key_encrypted: 'ciphertext',
        is_system: false
      }]
    });

    const response = await request('/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        providerId: '00000000-0000-4000-8000-000000000000',
        modelId: 'gpt-4o-mini',
        modelType: 'llm'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(secureFetchMock).toHaveBeenCalledWith(
      'https://proxy.example/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer plain-secret'
        })
      })
    );
  });
});
