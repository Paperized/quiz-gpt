import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomState,
  randomNonce,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
  type Configuration,
} from 'openid-client';
import { config } from './config.js';
import { logger } from './logger.js';
import { OIDC_GROUPS } from './types.js';
import type { OIDCGroup } from './types.js';

let oidcConfig: Configuration | null = null;

export function isOidcConfigured(): boolean {
  return Boolean(config.OIDC_ISSUER && config.OIDC_CLIENT_ID && config.OIDC_CLIENT_SECRET && config.OIDC_REDIRECT_URI);
}

export async function initOIDC(): Promise<Configuration | null> {
  if (!isOidcConfigured()) return null;
  if (oidcConfig) return oidcConfig;

  oidcConfig = await discovery(new URL(config.OIDC_ISSUER!), config.OIDC_CLIENT_ID!, {
    client_secret: config.OIDC_CLIENT_SECRET!,
  });

  logger.info('oidc_initialized', { issuer: oidcConfig.serverMetadata().issuer });
  return oidcConfig;
}

export async function getOidcLoginParams(): Promise<{ url: string; state: string; nonce: string }> {
  await initOIDC();
  if (!oidcConfig) throw new Error('OIDC not configured');

  const state = randomState();
  const nonce = randomNonce();
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

  oidcStateStore.set(state, { codeVerifier, nonce });

  const url = buildAuthorizationUrl(oidcConfig, {
    scope: config.OIDC_SCOPE,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: config.OIDC_REDIRECT_URI!,
  });

  return { url: url.toString(), state, nonce };
}

export async function handleOidcCallback(
  callbackUrl: string
): Promise<{ sub: string; email: string; name: string | null; role: 'super_admin' | 'admin' | 'user' }> {
  await initOIDC();
  if (!oidcConfig) throw new Error('OIDC not configured');

  const url = new URL(callbackUrl, config.PUBLIC_URL);
  const state = url.searchParams.get('state');
  if (!state) throw new Error('Missing state parameter');

  const stored = oidcStateStore.get(state);
  if (!stored) throw new Error('Invalid or expired state');
  oidcStateStore.delete(state);

  const response = await authorizationCodeGrant(
    oidcConfig,
    url,
    {
      pkceCodeVerifier: stored.codeVerifier,
      expectedState: state,
      expectedNonce: stored.nonce,
    }
  );

  const claims: Record<string, unknown> = (response as any).claims?.() ?? {};

  const sub = claims['sub'] as string | undefined;
  const email = claims['email'] as string | undefined;
  const name = (claims['name'] ?? claims['preferred_username'] ?? null) as string | null;

  if (!sub || !email) {
    throw new Error('ID token missing required claims (sub, email)');
  }

  let role: 'admin' | 'user' | 'super_admin' = 'user';
  const groups: string[] = (claims['groups'] as string[]) ?? [];

  if (groups.includes('quiz_super_admin')) {
    role = 'super_admin';
  } else if (groups.includes('quiz_admin')) {
    role = 'admin';
  } else if (groups.includes('quiz_user')) {
    role = 'user';
  } else {
    throw new Error('ACCESS_DENIED');
  }

  return { sub, email, name, role };
}

// In-memory state store
const oidcStateStore = new Map<string, { codeVerifier: string; nonce: string }>();

// Clean up entries every 5 minutes
setInterval(() => {
  oidcStateStore.clear();
}, 5 * 60 * 1000);
