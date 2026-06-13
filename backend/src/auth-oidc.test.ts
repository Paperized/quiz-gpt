import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const discoveryMock = vi.fn();
const buildAuthorizationUrlMock = vi.fn();
const authorizationCodeGrantMock = vi.fn();
const calculateChallengeMock = vi.fn();

vi.mock('openid-client', () => ({
  discovery: discoveryMock,
  buildAuthorizationUrl: buildAuthorizationUrlMock,
  authorizationCodeGrant: authorizationCodeGrantMock,
  randomState: vi.fn(() => 'state-1'),
  randomNonce: vi.fn(() => 'nonce-1'),
  randomPKCECodeVerifier: vi.fn(() => 'verifier-1'),
  calculatePKCECodeChallenge: calculateChallengeMock
}));

vi.mock('./config.js', () => ({
  config: {
    PUBLIC_URL: 'https://quiz.example',
    OIDC_ISSUER: 'https://issuer.example',
    OIDC_CLIENT_ID: 'client-id',
    OIDC_CLIENT_SECRET: 'client-secret',
    OIDC_REDIRECT_URI: 'https://quiz.example/api/auth/callback/oidc',
    OIDC_SCOPE: 'openid profile email groups'
  }
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}));

let getOidcLoginParams: typeof import('./auth-oidc.js').getOidcLoginParams;
let handleOidcCallback: typeof import('./auth-oidc.js').handleOidcCallback;
let isOidcConfigured: typeof import('./auth-oidc.js').isOidcConfigured;

beforeAll(async () => {
  ({ getOidcLoginParams, handleOidcCallback, isOidcConfigured } = await import('./auth-oidc.js'));
});

beforeEach(() => {
  discoveryMock.mockReset();
  buildAuthorizationUrlMock.mockReset();
  authorizationCodeGrantMock.mockReset();
  calculateChallengeMock.mockReset();

  discoveryMock.mockResolvedValue({
    serverMetadata: () => ({ issuer: 'https://issuer.example' })
  });
  calculateChallengeMock.mockResolvedValue('challenge-1');
  buildAuthorizationUrlMock.mockReturnValue(new URL('https://issuer.example/auth?state=state-1'));
});

describe('auth-oidc', () => {
  it('detects when OIDC is configured', () => {
    expect(isOidcConfigured()).toBe(true);
  });

  it('builds login parameters with PKCE state and nonce', async () => {
    const result = await getOidcLoginParams();

    expect(result).toEqual({
      url: 'https://issuer.example/auth?state=state-1',
      state: 'state-1',
      nonce: 'nonce-1'
    });
    expect(buildAuthorizationUrlMock).toHaveBeenCalled();
    expect(calculateChallengeMock).toHaveBeenCalledWith('verifier-1');
  });

  it('maps OIDC groups to application roles during callback', async () => {
    await getOidcLoginParams();
    authorizationCodeGrantMock.mockResolvedValue({
      claims: () => ({
        sub: 'oidc-user-1',
        email: 'oidc@example.com',
        name: 'OIDC User',
        groups: ['quiz_admin']
      })
    });

    const result = await handleOidcCallback('https://quiz.example/api/auth/callback/oidc?code=abc&state=state-1');

    expect(result).toEqual({
      sub: 'oidc-user-1',
      email: 'oidc@example.com',
      name: 'OIDC User',
      role: 'admin'
    });
    expect(authorizationCodeGrantMock).toHaveBeenCalled();
  });

  it('rejects users without an allowed group', async () => {
    await getOidcLoginParams();
    authorizationCodeGrantMock.mockResolvedValue({
      claims: () => ({
        sub: 'oidc-user-2',
        email: 'oidc@example.com',
        groups: ['employees']
      })
    });

    await expect(
      handleOidcCallback('https://quiz.example/api/auth/callback/oidc?code=abc&state=state-1')
    ).rejects.toThrow('ACCESS_DENIED');
  });
});
