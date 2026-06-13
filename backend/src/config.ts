import { z } from 'zod';

export const DEFAULT_LLM_MAX_TOKENS = 2000;
export const DEFAULT_LLM_TEMPERATURE = 0.7;
export const DEFAULT_EMBEDDING_BATCH_SIZE = 64;
export const DEFAULT_MAX_RETRIEVED_CHUNKS = 16;
export const DEFAULT_MAX_RETRIEVED_CHARS = 28000;
export const DEFAULT_MAX_EMBEDDING_CANDIDATES = 220;
export const ANTHROPIC_API_VERSION = '2023-06-01';

export const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  GITHUB_TOKEN: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(0).default(0),
  GENERATE_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(0).default(0),
  MULTI_SELECT_PENALTY_ALPHA: z.coerce.number().positive().default(1),
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().optional(),
  OIDC_SCOPE: z.string().default('openid profile email groups'),
  DISABLE_EMAIL_REGISTER: z.preprocess((v) => {
    if (typeof v === 'string') return v === 'true' || v === '1';
    return v;
  }, z.boolean().default(false)),
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRY: z.string().default('7d')
});

// Strip empty strings so Zod .default() kicks in instead of failing validation
const env = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v === '' ? undefined : v])
);

export const config = configSchema.parse(env);
