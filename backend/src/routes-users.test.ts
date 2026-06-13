import express from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const hashPasswordMock = vi.fn(async (value: string) => `hashed:${value}`);

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
  hashPassword: hashPasswordMock
}));

let userRoutes: typeof import('./routes-users.js').userRoutes;

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
  ({ userRoutes } = await import('./routes-users.js'));
});

beforeEach(() => {
  queryMock.mockReset();
  hashPasswordMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
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

    (userRoutes as unknown as { handle: (req: express.Request, res: express.Response, next: (error?: unknown) => void) => void }).handle(
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

describe('userRoutes access control', () => {
  it('blocks non-admin users from listing users', async () => {
    const response = await request('/', {
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('creates a user when requested by an admin', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-2',
          email: 'new@example.com',
          name: 'New User',
          role: 'admin',
          auth_provider: 'email',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z'
        }]
      });

    const response = await request('/', {
      method: 'POST',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: {
        email: 'new@example.com',
        password: 'supersecret',
        name: 'New User',
        role: 'admin'
      }
    });

    expect(response.status).toBe(201);
    expect(hashPasswordMock).toHaveBeenCalledWith('supersecret');
    expect(response.body).toMatchObject({
      id: 'user-2',
      email: 'new@example.com',
      role: 'admin',
      authProvider: 'email'
    });
  });

  it('prevents an admin from demoting themselves', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ role: 'admin' }] });

    const response = await request('/admin-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: { role: 'user' }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot demote yourself' });
  });

  it('prevents modifying the super admin account', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ role: 'super_admin' }] });

    const response = await request('/root-1', {
      method: 'PATCH',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      },
      body: { role: 'user' }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Cannot modify the super admin' });
  });

  it('prevents deleting the last admin', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    const response = await request('/admin-2', {
      method: 'DELETE',
      headers: {
        'x-user-id': 'admin-1',
        'x-user-role': 'admin'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Cannot delete the last admin' });
  });
});
