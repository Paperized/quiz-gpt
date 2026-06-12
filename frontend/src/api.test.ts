import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('req', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed json for successful responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));

    const { req } = await import('./api');

    await expect(req('/api/test')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/test', undefined);
  });

  it('returns undefined on 204 responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const { req } = await import('./api');

    await expect(req('/api/test')).resolves.toBeUndefined();
  });

  it('surfaces backend error payloads and falls back to status text', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Bad request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      }))
      .mockResolvedValueOnce(new Response('fail', { status: 503 }));

    const { req } = await import('./api');

    await expect(req('/api/test')).rejects.toThrow('Bad request');
    await expect(req('/api/test')).rejects.toThrow('Request failed: 503');
  });
});
