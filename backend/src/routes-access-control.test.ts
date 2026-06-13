import express from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const decryptValueMock = vi.fn(() => 'plain-secret');

vi.mock('./db.js', () => ({
  pool: {
    query: queryMock
  }
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

vi.mock('./config.js', () => ({
  config: {
    SETTINGS_ENCRYPTION_KEY: 'enc-key',
    ANTHROPIC_VERSION: '2023-06-01'
  }
}));

vi.mock('./encryption.js', () => ({
  encryptValue: vi.fn((value: string) => `enc:${value}`),
  decryptValue: decryptValueMock,
  maskSecret: vi.fn(() => '••••••••')
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

let modelRoutes: typeof import('./routes-models.js').modelRoutes;
let providerRoutes: typeof import('./routes-providers.js').providerRoutes;

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
  ({ providerRoutes } = await import('./routes-providers.js'));
});

beforeEach(() => {
  queryMock.mockReset();
  decryptValueMock.mockClear();
  vi.unstubAllGlobals();
});

async function request(
  router: express.Router,
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

    (router as unknown as { handle: (req: express.Request, res: express.Response, next: (error?: unknown) => void) => void }).handle(
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
    });
  });
}

describe('modelRoutes access control', () => {
  it('blocks setting a default model when the user has no access to it', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false,
        has_access: false
      }]
    });

    const response = await request(modelRoutes, '/model-1/default', {
      method: 'PUT',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Not authorized' });
  });

  it('blocks testing a model when the user has no access to it', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false,
        has_access: false
      }]
    });

    const response = await request(modelRoutes, '/model-1/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Not authorized' });
  });

  it('allows testing an owned model and uses the provider endpoint', async () => {
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
          id: 'model-1',
          provider: 'openai',
          provider_id: null,
          base_url: null,
          api_key_encrypted: 'ciphertext',
          model_id: 'gpt-4o-mini',
          model_type: 'llm'
        }]
      });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(modelRoutes, '/model-1/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('providerRoutes access control', () => {
  it('blocks testing a provider when the user has no access to it', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false,
        has_access: false
      }]
    });

    const response = await request(providerRoutes, '/provider-1/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Not authorized' });
  });

  it('blocks listing remote provider models when the user has no access to it', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false,
        has_access: false
      }]
    });

    const response = await request(providerRoutes, '/provider-1/models', {
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Not authorized' });
  });

  it('allows the owner to list remote provider models', async () => {
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
          provider: 'openai',
          base_url: 'https://proxy.example/v1',
          api_key_encrypted: 'ciphertext'
        }]
      });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(providerRoutes, '/provider-1/models', {
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ models: ['gpt-4o', 'text-embedding-3-small'] });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer plain-secret'
        })
      })
    );
  });
});
