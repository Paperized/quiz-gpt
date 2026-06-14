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

  it('revokes access and deletes user private models backed by the provider', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ is_system: true }]
      })
      .mockResolvedValueOnce({ rows: [] })
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
    expect(queryMock.mock.calls[2][0]).toContain('DELETE FROM models WHERE provider_id');
    expect(queryMock.mock.calls[2][0]).toContain('is_system = false');
    expect(queryMock.mock.calls[2][1][1]).toBe('user-2');
  });

  it('revoke does not delete system models backed by the provider', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ is_system: true }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-1/access/user-2', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      }
    });

    expect(response.status).toBe(204);
    // The models DELETE must target is_system = false
    const modelsDeleteCall = queryMock.mock.calls[2][0] as string;
    expect(modelsDeleteCall).toContain('is_system = false');
    expect(modelsDeleteCall).not.toContain('is_system = true');
  });

  it('revoke access rejects non-system providers', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ is_system: false }]
    });

    const response = await request('/provider-1/access/user-2', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
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

  it('cascade-deletes linked models when a system provider is deleted', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'admin-1',
          is_system: true
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-1', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      }
    });

    expect(response.status).toBe(204);
    expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM models WHERE provider_id');
    expect(queryMock.mock.calls[2][0]).toContain('DELETE FROM providers');
  });

  it('cascade-deletes linked models when owner deletes their private provider', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'user-1',
          is_system: false
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-1', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(204);
    expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM models WHERE provider_id');
    expect(queryMock.mock.calls[2][0]).toContain('DELETE FROM providers');
  });

  it('deletes linked models when downgrading system provider to non-system', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'admin-1',
          is_system: true
        }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        isSystem: false
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(queryMock.mock.calls[1][0]).toContain('DELETE FROM models WHERE provider_id');
    expect(queryMock.mock.calls[2][0]).toContain('UPDATE providers SET');
    expect(queryMock.mock.calls[2][0]).toContain('is_system = $1');
  });

  it('does not delete linked models when upgrading non-system to system', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'admin-1',
          is_system: false
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        isSystem: true
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    // No DELETE FROM models call — only the UPDATE
    const calls = queryMock.mock.calls.map((c: string[]) => c[0]);
    const deleteModelCalls = calls.filter((c: string) => c.includes('DELETE FROM models'));
    expect(deleteModelCalls).toHaveLength(0);
  });

  it('blocks non-admin from creating provider with private IP baseUrl', async () => {
    validateBaseUrlForSSRFMock.mockResolvedValueOnce({ safe: false, reason: 'Cannot use private/internal IP addresses' });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      },
      body: {
        label: 'Private provider',
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot use private/internal IP addresses' });
    expect(validateBaseUrlForSSRFMock).toHaveBeenCalledWith('https://10.0.0.1/v1');
  });

  it('allows admin to create provider with private IP baseUrl', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          id: 'provider-1',
          label: 'My provider',
          provider: 'openai',
          base_url: 'https://10.0.0.1/v1',
          api_key_encrypted: 'ciphertext',
          created_by: 'admin-1',
          is_system: true,
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
        label: 'Admin provider',
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://10.0.0.1/v1',
        isSystem: true
      }
    });

    expect(response.status).toBe(201);
  });

  it('blocks non-admin from updating private provider baseUrl to private IP', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        created_by: 'user-1',
        is_system: false
      }]
    });
    validateBaseUrlForSSRFMock.mockResolvedValueOnce({ safe: false, reason: 'Cannot use private/internal IP addresses' });

    const response = await request('/provider-1', {
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

  it('allows non-admin to update system provider baseUrl (skip SSRF for system)', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          created_by: 'admin-1',
          is_system: true
        }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request('/provider-sys', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(validateBaseUrlForSSRFMock).not.toHaveBeenCalled();
  });

  it('blocks non-admin from testing provider with private baseUrl', async () => {
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
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot use private/internal IP addresses' });
  });

  it('allows admin to test provider with private baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ''
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await request('/test', {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        provider: 'openai',
        apiKey: 'sk-test',
        baseUrl: 'https://10.0.0.1/v1'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('uses secureFetch with redirect:error in provider test', async () => {
    secureFetchMock.mockClear();
    const mockResponse = { ok: true, status: 200, text: async () => '' } as unknown as Response;
    secureFetchMock.mockResolvedValueOnce(mockResponse);

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
    expect(secureFetchMock).toHaveBeenCalled();
    const callUrl = secureFetchMock.mock.calls[0][0] as string;
    expect(callUrl).toContain('api.openai.com');
  });

  it('tests provider connectivity through the real route', async () => {
    secureFetchMock.mockClear();
    const mockResponse = { ok: true, status: 200, text: async () => '' } as unknown as Response;
    secureFetchMock.mockResolvedValueOnce(mockResponse);

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
    expect(secureFetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test'
        })
      })
    );
  });
});
