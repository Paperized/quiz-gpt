import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  LLM_API_STYLE: z.enum(['openai', 'anthropic', 'openai_compatible']).default('openai'),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o'),
  LLM_MAX_TOKENS: z.coerce.number().default(2000),
  LLM_TEMPERATURE: z.coerce.number().default(0.7),
  ANTHROPIC_VERSION: z.string().default('2023-06-01'),
  GITHUB_TOKEN: z.string().optional(),
  MAX_RETRIEVED_CHUNKS: z.coerce.number().int().min(4).max(40).default(16),
  MAX_RETRIEVED_CHARS: z.coerce.number().int().min(4000).max(120000).default(28000),
  MAX_EMBEDDING_CANDIDATES: z.coerce.number().int().min(20).max(500).default(220),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(4).max(256).default(64),
  EMBEDDING_API_STYLE: z.enum(['same_as_llm', 'openai', 'anthropic', 'openai_compatible']).default('same_as_llm'),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  BASIC_AUTH_USERNAME: z.string().optional(),
  BASIC_AUTH_PASSWORD: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(300),
  GENERATE_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20)
});

export const config = configSchema.parse(process.env);
