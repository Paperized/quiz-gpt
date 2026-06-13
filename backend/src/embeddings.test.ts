import { beforeAll, describe, expect, it } from 'vitest';

let normalizeProvider: typeof import('./embeddings.js').normalizeProvider;
let rankByEmbeddingSimilarity: typeof import('./embeddings.js').rankByEmbeddingSimilarity;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
  ({ normalizeProvider, rankByEmbeddingSimilarity } = await import('./embeddings.js'));
});

describe('normalizeProvider', () => {
  it('maps openai to openai', () => {
    expect(normalizeProvider('openai')).toBe('openai');
  });

  it('maps anthropic to anthropic', () => {
    expect(normalizeProvider('anthropic')).toBe('anthropic');
  });

  it('maps openai_compatible to openai_compatible', () => {
    expect(normalizeProvider('openai_compatible')).toBe('openai_compatible');
  });

  it('maps any unknown provider to openai_compatible', () => {
    expect(normalizeProvider('google')).toBe('openai_compatible');
    expect(normalizeProvider('mistral')).toBe('openai_compatible');
    expect(normalizeProvider('azure')).toBe('openai_compatible');
  });

  it('is case-insensitive', () => {
    expect(normalizeProvider('OPENAI')).toBe('openai');
    expect(normalizeProvider('Anthropic')).toBe('anthropic');
    expect(normalizeProvider('OpenAI_Compatible')).toBe('openai_compatible');
  });
});

describe('rankByEmbeddingSimilarity', () => {
  it('returns cosine similarity scores for candidate embeddings', () => {
    const query = [1, 0, 0];
    const candidates = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const scores = rankByEmbeddingSimilarity(query, candidates);
    expect(scores).toHaveLength(3);
    expect(scores[0]).toBeCloseTo(1.0, 5);
    expect(scores[1]).toBeCloseTo(0.0, 5);
    expect(scores[2]).toBeCloseTo(0.0, 5);
  });

  it('handles zero vectors', () => {
    const scores = rankByEmbeddingSimilarity([1, 2, 3], [[0, 0, 0]]);
    expect(scores[0]).toBe(0);
  });

  it('returns empty array for empty candidates', () => {
    const scores = rankByEmbeddingSimilarity([1, 2], []);
    expect(scores).toEqual([]);
  });
});
