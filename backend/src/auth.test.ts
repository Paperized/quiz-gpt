import { beforeAll, describe, expect, it } from 'vitest';
import type { JwtPayload } from './auth.js';

let signJWT: typeof import('./auth.js').signJWT;
let verifyJWT: typeof import('./auth.js').verifyJWT;
let hashPassword: typeof import('./auth.js').hashPassword;
let verifyPassword: typeof import('./auth.js').verifyPassword;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-only';
  ({ signJWT, verifyJWT, hashPassword, verifyPassword } = await import('./auth.js'));
});

describe('JWT sign and verify', () => {
  it('signs and verifies a valid token', () => {
    const payload: JwtPayload = { sub: 'user-1', role: 'admin' };
    const token = signJWT(payload);
    const decoded = verifyJWT(token);
    expect(decoded.sub).toBe('user-1');
    expect(decoded.role).toBe('admin');
  });

  it('signs with super_admin role', () => {
    const payload: JwtPayload = { sub: 'user-2', role: 'super_admin' };
    const token = signJWT(payload);
    const decoded = verifyJWT(token);
    expect(decoded.role).toBe('super_admin');
  });

  it('rejects invalid token', () => {
    expect(() => verifyJWT('not.a.valid.token')).toThrow();
  });

  it('rejects token with tampered payload', () => {
    const token = signJWT({ sub: 'user-3', role: 'user' });
    // Tamper with the payload
    const [header, payload] = token.split('.');
    const tampered = `${header}.${payload}X.invalidsig`;
    expect(() => verifyJWT(tampered)).toThrow();
  });
});

describe('Password hashing', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('my-password');
    expect(hash).not.toBe('my-password');
    expect(await verifyPassword('my-password', hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('correct');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('same password produces different hashes', async () => {
    const h1 = await hashPassword('same');
    const h2 = await hashPassword('same');
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('same', h1)).toBe(true);
    expect(await verifyPassword('same', h2)).toBe(true);
  });
});
