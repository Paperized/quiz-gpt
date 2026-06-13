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
  ({ providerRoutes } = await import('./routes-providers.js'));
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

    (providerRoutes as unknown as { handle: (req: express.Request, res: express.Response, next: (error?: unknown) => void) => void }).handle(
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

describe('providerRoutes', () => {
  it('lists only accessible providers for a non-admin user', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'provider-1',
        label: 'Assigned provider',
        provider: 'openai',
        base_url: null,
        api_key_encrypted: 'ciphertext',
        created_by: 'owner-1',
        is_system: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        assigned_to: null
      }]
    });

    const response = await request('/', {
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(200);
    expect(queryMock.mock.calls[0][0]).toContain('WHERE (p.is_system = true AND EXISTS');
    expect(response.body).toEqual([
      expect.objectContaining({
        id: 'provider-1',
        isSystem: true
      })
    ]);
  });

  it('rejects invalid provider payloads through the real route', async () => {
    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'Bad provider',
        provider: 'google',
        apiKey: 'sk-test'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid input' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('creates a private provider for non-admin users even if isSystem is requested', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'provider-1',
          label: 'My provider',
          provider: 'openai',
          base_url: null,
          api_key_encrypted: 'ciphertext',
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
        label: 'My provider',
        provider: 'openai',
        apiKey: 'sk-test',
        isSystem: true
      }
    });

    expect(response.status).toBe(201);
    expect(encryptValueMock).toHaveBeenCalledWith('sk-test', 'enc-key');
    expect(queryMock.mock.calls[0][1][5]).toBe(false);
    expect(response.body).toMatchObject({
      id: 'provider-1',
      isSystem: false,
      provider: 'openai'
    });
  });

  it('prevents admins from editing another user private provider', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false
      }]
    });

    const response = await request('/provider-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        label: 'Updated provider'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Cannot edit private provider' });
  });

  it('grants access only to system providers', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        is_system: false
      }]
    });

    const response = await request('/provider-1/access', {
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
    expect(response.body).toEqual({ error: 'Only system providers' });
  });

  it('prevents non-owners from deleting a private provider', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'owner-1',
        is_system: false
      }]
    });

    const response = await request('/provider-1', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Not authorized' });
  });

  it('revokes access from a system provider', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          is_system: true
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-1/access/user-2', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      }
    });

    expect(response.status).toBe(204);
    expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM provider_access');
  });

  it('tests provider connectivity through the real route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request('/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        provider: 'openai',
        apiKey: 'sk-test'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test'
        })
      })
    );
  });
});
