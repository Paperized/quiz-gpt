import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// Replicate the schemas from routes-providers.ts for unit testing
const providerCreateSchema = z.object({
  label: z.string().min(1).max(255),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']),
  apiKey: z.string().min(1).max(1024),
  baseUrl: z.string().max(1024).optional(),
  isSystem: z.boolean().optional(),
});

const providerUpdateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  apiKey: z.string().min(1).max(1024).optional(),
  baseUrl: z.string().max(1024).optional(),
});

const providerTestSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']),
  baseUrl: z.string().max(1024).optional(),
  apiKey: z.string().min(1).max(1024),
});

describe('providerCreateSchema', () => {
  it('accepts valid openai provider', () => {
    const result = providerCreateSchema.safeParse({
      label: 'My OpenAI', provider: 'openai', apiKey: 'sk-123'
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid anthropic provider', () => {
    const result = providerCreateSchema.safeParse({
      label: 'My Anthropic', provider: 'anthropic', apiKey: 'sk-123'
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid openai_compatible provider', () => {
    const result = providerCreateSchema.safeParse({
      label: 'My LiteLLM', provider: 'openai_compatible', apiKey: 'sk-123', baseUrl: 'https://llm.example.com/v1'
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider value', () => {
    const result = providerCreateSchema.safeParse({
      label: 'Bad', provider: 'google', apiKey: 'sk-123'
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing apiKey', () => {
    const result = providerCreateSchema.safeParse({
      label: 'No Key', provider: 'openai'
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty label', () => {
    const result = providerCreateSchema.safeParse({
      label: '', provider: 'openai', apiKey: 'sk-123'
    });
    expect(result.success).toBe(false);
  });
});

describe('providerUpdateSchema', () => {
  it('allows partial update with only label', () => {
    const result = providerUpdateSchema.safeParse({ label: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('allows updating provider to valid value', () => {
    const result = providerUpdateSchema.safeParse({ provider: 'anthropic' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider in update', () => {
    const result = providerUpdateSchema.safeParse({ provider: 'invalid_provider' });
    expect(result.success).toBe(false);
  });
});

describe('providerTestSchema', () => {
  it('accepts all three provider types', () => {
    ['openai', 'anthropic', 'openai_compatible'].forEach((p) => {
      const result = providerTestSchema.safeParse({ provider: p, apiKey: 'sk-123' });
      expect(result.success).toBe(true);
    });
  });

  it('accepts optional baseUrl', () => {
    const result = providerTestSchema.safeParse({
      provider: 'openai_compatible', apiKey: 'sk-123', baseUrl: 'https://custom.example.com'
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing provider', () => {
    const result = providerTestSchema.safeParse({ apiKey: 'sk-123' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown provider', () => {
    const result = providerTestSchema.safeParse({ provider: 'azure', apiKey: 'sk-123' });
    expect(result.success).toBe(false);
  });
});
