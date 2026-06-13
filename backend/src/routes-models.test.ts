import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

// Replicate schemas from routes-models.ts
const modelCreateSchema = z.object({
  label: z.string().min(1).max(255),
  modelType: z.enum(['llm', 'embedding']).default('llm'),
  providerId: z.string().uuid().optional(),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  modelId: z.string().min(1).max(255),
  apiKey: z.string().min(1).max(1024).optional(),
  baseUrl: z.string().max(1024).optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxRetrievedChunks: z.coerce.number().int().positive().optional(),
  maxRetrievedChars: z.coerce.number().int().positive().optional(),
  maxEmbeddingCandidates: z.coerce.number().int().positive().optional(),
  embeddingBatchSize: z.coerce.number().int().positive().optional(),
  isSystem: z.boolean().optional(),
});

const modelUpdateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  modelId: z.string().min(1).max(255).optional(),
  apiKey: z.string().min(1).max(1024).optional(),
  baseUrl: z.string().max(1024).optional(),
  maxTokens: z.coerce.number().int().positive().optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).optional().nullable(),
  maxRetrievedChunks: z.coerce.number().int().positive().optional().nullable(),
  maxRetrievedChars: z.coerce.number().int().positive().optional().nullable(),
  maxEmbeddingCandidates: z.coerce.number().int().positive().optional().nullable(),
  embeddingBatchSize: z.coerce.number().int().positive().optional().nullable(),
});

const modelTestSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  baseUrl: z.string().max(1024).optional(),
  apiKey: z.string().min(1).max(1024).optional(),
  providerId: z.string().uuid().optional(),
  modelId: z.string().min(1).max(255),
  modelType: z.enum(['llm', 'embedding']),
});

describe('modelCreateSchema', () => {
  it('accepts valid LLM model with provider from enum', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Test LLM', provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-123'
    });
    expect(result.success).toBe(true);
  });

  it('accepts model with providerId (no provider/manual fields)', () => {
    const result = modelCreateSchema.safeParse({
      label: 'From Provider', modelId: 'gpt-4o', providerId: '00000000-0000-4000-8000-000000000000'
    });
    expect(result.success).toBe(true);
  });

  it('accepts embedding model', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Embed', modelType: 'embedding', provider: 'openai', modelId: 'text-embedding-3-small', apiKey: 'sk-123'
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider enum value', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Bad', provider: 'google', modelId: 'gpt-4o', apiKey: 'sk-123'
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty modelId', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Empty', provider: 'openai', modelId: '', apiKey: 'sk-123'
    });
    expect(result.success).toBe(false);
  });

  it('defaults modelType to llm', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Default', provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-123'
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.modelType).toBe('llm');
  });

  it('rejects temperature above 2', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Hot', provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-123', temperature: 3
    });
    expect(result.success).toBe(false);
  });

  it('accepts temperature within 0-2 range', () => {
    const result = modelCreateSchema.safeParse({
      label: 'Warm', provider: 'openai', modelId: 'gpt-4o', apiKey: 'sk-123', temperature: 1.2
    });
    expect(result.success).toBe(true);
  });
});

describe('modelUpdateSchema', () => {
  it('allows partial update with only label', () => {
    const result = modelUpdateSchema.safeParse({ label: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('allows setting maxTokens to null (clear)', () => {
    const result = modelUpdateSchema.safeParse({ maxTokens: null });
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider in update', () => {
    const result = modelUpdateSchema.safeParse({ provider: 'azure' });
    expect(result.success).toBe(false);
  });
});

describe('modelTestSchema', () => {
  it('accepts manual config with provider + apiKey', () => {
    const result = modelTestSchema.safeParse({
      provider: 'openai', apiKey: 'sk-123', modelId: 'gpt-4o', modelType: 'llm'
    });
    expect(result.success).toBe(true);
  });

  it('accepts providerId instead of provider + apiKey', () => {
    const result = modelTestSchema.safeParse({
      providerId: '00000000-0000-4000-8000-000000000000', modelId: 'gpt-4o', modelType: 'llm'
    });
    expect(result.success).toBe(true);
  });

  it('accepts embedding modelType', () => {
    const result = modelTestSchema.safeParse({
      provider: 'openai', apiKey: 'sk-123', modelId: 'text-embedding-3-small', modelType: 'embedding'
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing modelId', () => {
    const result = modelTestSchema.safeParse({
      provider: 'openai', apiKey: 'sk-123', modelType: 'llm'
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid modelType', () => {
    const result = modelTestSchema.safeParse({
      provider: 'openai', apiKey: 'sk-123', modelId: 'gpt-4o', modelType: 'vision'
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-uuid providerId', () => {
    const result = modelTestSchema.safeParse({
      providerId: 'not-a-uuid', modelId: 'gpt-4o', modelType: 'llm'
    });
    expect(result.success).toBe(false);
  });
});
