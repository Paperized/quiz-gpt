import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  LLM_BASE_URL: z.string().default('https://api.openai.com/v1'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('gpt-4o'),
  LLM_MAX_TOKENS: z.coerce.number().default(2000),
  LLM_TEMPERATURE: z.coerce.number().default(0.7)
});

export const config = configSchema.parse(process.env);
