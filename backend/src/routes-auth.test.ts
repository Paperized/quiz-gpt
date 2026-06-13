import express from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const signJWTMock = vi.fn(() => 'jwt-token');
const setAuthCookieMock = vi.fn();
const clearAuthCookieMock = vi.fn();
const hashPasswordMock = vi.fn(async (value: string) => `hashed:${value}`);
const verifyPasswordMock = vi.fn();
const bootstrapFirstUserMock = vi.fn();
const isOidcConfiguredMock = vi.fn(() => false);
const getOidcLoginParamsMock = vi.fn();
const handleOidcCallbackMock = vi.fn();

const configMock = {
  DISABLE_EMAIL_REGISTER: false,
  SETTINGS_ENCRYPTION_KEY: 'enc-key',
  PUBLIC_URL: 'https://quiz.example'
};

vi.mock('./db.js', () => ({
  pool: {
    query: queryMock
  }
}));

vi.mock('./config.js', () => ({
  config: configMock
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

vi.mock('./auth.js', () => ({
  signJWT: signJWTMock,
  verifyJWT: vi.fn(),
  setAuthCookie: setAuthCookieMock,
  clearAuthCookie: clearAuthCookieMock,
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
  bootstrapFirstUser: bootstrapFirstUserMock,
  authRequired: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = req.header('x-user-id');
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    req.user = {
      id: userId,
      email: `${userId}@example.com`,
      name: null,
      role: (req.header('x-user-role') ?? 'user') as 'super_admin' | 'admin' | 'user'
    };
    next();
  }
}));

vi.mock('./auth-oidc.js', () => ({
  getOidcLoginParams: getOidcLoginParamsMock,
  handleOidcCallback: handleOidcCallbackMock,
  isOidcConfigured: isOidcConfiguredMock
}));

let authRoutes: typeof import('./routes-auth.js').authRoutes;

type MockResponse = {
  statusCode: number;
  headersSent: boolean;
  locals: Record<string, unknown>;
  redirectUrl: string | null;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload?: unknown) => MockResponse;
  end: (payload?: unknown) => MockResponse;
  redirect: (url: string) => MockResponse;
  cookie: (...args: unknown[]) => MockResponse;
};

beforeAll(async () => {
  ({ authRoutes } = await import('./routes-auth.js'));
});

beforeEach(() => {
  queryMock.mockReset();
  signJWTMock.mockClear();
  setAuthCookieMock.mockClear();
  clearAuthCookieMock.mockClear();
  hashPasswordMock.mockClear();
  verifyPasswordMock.mockReset();
  bootstrapFirstUserMock.mockClear();
  isOidcConfiguredMock.mockReset();
  getOidcLoginParamsMock.mockReset();
  handleOidcCallbackMock.mockReset();
  configMock.DISABLE_EMAIL_REGISTER = false;
  configMock.SETTINGS_ENCRYPTION_KEY = 'enc-key';
  isOidcConfiguredMock.mockReturnValue(false);
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
    cookies: {},
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  } as express.Request;

  return await new Promise<{ status: number; body: unknown; redirectUrl: string | null }>((resolve, reject) => {
    const res: MockResponse = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      redirectUrl: null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload, redirectUrl: this.redirectUrl });
        return this;
      },
      send(payload?: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload ?? null, redirectUrl: this.redirectUrl });
        return this;
      },
      end(payload?: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload ?? null, redirectUrl: this.redirectUrl });
        return this;
      },
      redirect(url: string) {
        this.headersSent = true;
        this.redirectUrl = url;
        resolve({ status: this.statusCode, body: null, redirectUrl: url });
        return this;
      },
      cookie() {
        return this;
      }
    };

    (authRoutes as unknown as { handle: (req: express.Request, res: express.Response, next: (error?: unknown) => void) => void }).handle(
      req,
      res as unknown as express.Response,
      (error: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        if (!res.headersSent) {
          resolve({ status: 404, body: null, redirectUrl: null });
        }
      }
    );
  });
}

describe('authRoutes', () => {
  it('returns auth status flags from configuration and user count', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ cnt: 2 }]
    });
    isOidcConfiguredMock.mockReturnValue(true);

    const response = await request('/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      hasUsers: true,
      oidcEnabled: true,
      emailEnabled: true
    });
  });

  it('rejects email registration when disabled', async () => {
    configMock.DISABLE_EMAIL_REGISTER = true;

    const response = await request('/register', {
      method: 'POST',
      body: {
        email: 'user@example.com',
        password: 'supersecret'
      }
    });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Email registration is disabled' });
  });

  it('rejects invalid registration payloads', async () => {
    const response = await request('/register', {
      method: 'POST',
      body: {
        email: 'not-an-email',
        password: 'short'
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid input' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate email registration', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'user-1' }]
    });

    const response = await request('/register', {
      method: 'POST',
      body: {
        email: 'user@example.com',
        password: 'supersecret'
      }
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'Email already registered' });
  });

  it('registers a new email user and issues a session cookie', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-1',
          email: 'user@example.com',
          name: 'User',
          role: 'user',
          auth_provider: 'email'
        }]
      })
      .mockResolvedValueOnce({
        rows: [{ role: 'super_admin' }]
      });

    const response = await request('/register', {
      method: 'POST',
      body: {
        email: 'user@example.com',
        password: 'supersecret',
        name: 'User'
      }
    });

    expect(response.status).toBe(201);
    expect(hashPasswordMock).toHaveBeenCalledWith('supersecret');
    expect(bootstrapFirstUserMock).toHaveBeenCalledWith('user-1');
    expect(signJWTMock).toHaveBeenCalledWith({ sub: 'user-1', role: 'super_admin' });
    expect(setAuthCookieMock).toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      role: 'super_admin',
      authProvider: 'email',
      encryptionConfigured: true
    });
  });

  it('rejects login with invalid credentials', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        role: 'user',
        password_hash: 'stored-hash',
        auth_provider: 'email'
      }]
    });
    verifyPasswordMock.mockResolvedValue(false);

    const response = await request('/login', {
      method: 'POST',
      body: {
        email: 'user@example.com',
        password: 'wrong-password'
      }
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
    expect(setAuthCookieMock).not.toHaveBeenCalled();
  });

  it('rejects login payloads with invalid input', async () => {
    const response = await request('/login', {
      method: 'POST',
      body: {
        email: 'not-an-email',
        password: ''
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'Invalid input' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects login when no email user exists', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const response = await request('/login', {
      method: 'POST',
      body: {
        email: 'user@example.com',
        password: 'supersecret'
      }
    });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid credentials' });
  });

  it('logs in a valid email user and returns profile data', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        role: 'admin',
        password_hash: 'stored-hash',
        auth_provider: 'email'
      }]
    });
    verifyPasswordMock.mockResolvedValue(true);

    const response = await request('/login', {
      method: 'POST',
      body: {
        email: 'user@example.com',
        password: 'supersecret'
      }
    });

    expect(response.status).toBe(200);
    expect(signJWTMock).toHaveBeenCalledWith({ sub: 'user-1', role: 'admin' });
    expect(setAuthCookieMock).toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'user-1',
      role: 'admin',
      authProvider: 'email'
    });
  });

  it('clears the auth cookie when /me targets a missing user', async () => {
    queryMock.mockResolvedValueOnce({
      rows: []
    });

    const response = await request('/me', {
      headers: {
        'x-user-id': 'user-404',
        'x-user-role': 'user'
      }
    });

    expect(response.status).toBe(401);
    expect(clearAuthCookieMock).toHaveBeenCalled();
    expect(response.body).toEqual({ error: 'User not found' });
  });

  it('returns the authenticated user profile from /me', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'user-1',
        sub: null,
        email: 'user@example.com',
        name: 'User',
        role: 'admin',
        auth_provider: 'email',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z'
      }]
    });

    const response = await request('/me', {
      headers: {
        'x-user-id': 'user-1',
        'x-user-role': 'admin'
      }
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 'user-1',
      email: 'user@example.com',
      role: 'admin',
      authProvider: 'email',
      encryptionConfigured: true
    });
  });

  it('clears the auth cookie on logout', async () => {
    const response = await request('/logout', {
      method: 'POST'
    });

    expect(response.status).toBe(200);
    expect(clearAuthCookieMock).toHaveBeenCalled();
    expect(response.body).toEqual({ ok: true });
  });
});
