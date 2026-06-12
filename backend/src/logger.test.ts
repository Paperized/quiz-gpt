import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('logger', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  });

  it('summarizes text safely', async () => {
    const { summarizeText } = await import('./logger.js');

    expect(summarizeText(undefined)).toEqual({ present: false, chars: 0 });
    expect(summarizeText('  hello\nworld  ')).toEqual({
      present: true,
      chars: 15,
      preview: 'hello world'
    });
  });

  it('respects log levels and serializes errors', async () => {
    process.env.LOG_LEVEL = 'warn';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { logger } = await import('./logger.js');

    logger.info('info_event', { ok: true });
    logger.warn('warn_event', { code: 1 });
    logger.error('error_event', new Error('boom'), { op: 'save' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      level: 'warn',
      event: 'warn_event',
      code: 1
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0] as string)).toMatchObject({
      level: 'error',
      event: 'error_event',
      op: 'save',
      errorName: 'Error',
      errorMessage: 'boom'
    });
  });
});
