import { config } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function shouldLog(level: LogLevel): boolean {
  return priorities[level] >= priorities[config.LOG_LEVEL];
}

function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message
    };
  }
  return { errorMessage: String(error) };
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (!shouldLog(level)) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => write('debug', event, fields),
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, error?: unknown, fields: LogFields = {}) => write('error', event, {
    ...fields,
    ...serializeError(error)
  })
};

export function summarizeText(value: string | undefined): { present: boolean; chars: number; preview?: string; } {
  if (!value) return { present: false, chars: 0 };
  const normalized = value.replace(/\s+/g, ' ').trim();
  return {
    present: true,
    chars: value.length,
    preview: normalized.slice(0, 120)
  };
}
