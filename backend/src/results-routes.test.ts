import express from 'express';
import { Router } from 'express';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('./db.js', () => ({
  pool: {
    query: (...args: unknown[]) => queryMock(...args)
  },
  runMigrations: vi.fn(async () => {})
}));

vi.mock('helmet', () => ({
  default: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
}));

vi.mock('cookie-parser', () => ({
  default: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
}));

vi.mock('./config.js', () => ({
  config: {
    PORT: 3000,
    PUBLIC_URL: 'http://localhost:3000',
    RATE_LIMIT_WINDOW_MS: 900000,
    RATE_LIMIT_MAX_REQUESTS: 0,
    GENERATE_RATE_LIMIT_MAX_REQUESTS: 0,
    MULTI_SELECT_PENALTY_ALPHA: 1,
    SETTINGS_ENCRYPTION_KEY: 'enc-key'
  }
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  summarizeText: vi.fn((value: string) => value)
}));

vi.mock('./auth.js', () => ({
  authRequired: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = req.header('x-user-id');
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    req.user = {
      id: userId,
      email: `${userId}@example.com`,
      name: null,
      role: (req.header('x-user-role') ?? 'user') as 'super_admin' | 'admin' | 'user'
    };
    next();
  },
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  isAdminUser: (req: express.Request) => req.user?.role === 'admin' || req.user?.role === 'super_admin'
}));

vi.mock('./llm.js', () => ({
  generateQuizFromLLM: vi.fn(),
  proposeGroupQuizFromLLM: vi.fn(),
  evaluateFreeTextAnswers: vi.fn()
}));

vi.mock('./model-config.js', () => ({
  resolveLLMConfig: vi.fn(),
  resolveEmbeddingConfig: vi.fn(),
  getDefaultLLMConfig: vi.fn(),
  getDefaultEmbeddingConfig: vi.fn()
}));

vi.mock('./routes-auth.js', () => ({
  authRoutes: Router()
}));

vi.mock('./routes-users.js', () => ({
  userRoutes: Router()
}));

vi.mock('./routes-models.js', () => ({
  modelRoutes: Router()
}));

vi.mock('./routes-providers.js', () => ({
  providerRoutes: Router()
}));

let app: typeof import('./index.js').app;

type MockResponse = {
  statusCode: number;
  headersSent: boolean;
  locals: Record<string, unknown>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload?: unknown) => MockResponse;
  end: (payload?: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
};

beforeAll(async () => {
  ({ app } = await import('./index.js'));
});

beforeEach(() => {
  queryMock.mockReset();
});

async function request(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown }
) {
  const [pathname, search = ''] = path.split('?');
  const headers = Object.fromEntries(
    Object.entries(init?.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  const req = {
    method: init?.method ?? 'GET',
    url: path,
    originalUrl: path,
    path: pathname,
    headers,
    body: init?.body,
    params: {},
    query: Object.fromEntries(new URLSearchParams(search)),
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    get(name: string) {
      return headers[name.toLowerCase()];
    }
  } as express.Request;

  return await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const res: MockResponse = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload?: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload ?? null });
        return this;
      },
      end(payload?: unknown) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload ?? null });
        return this;
      },
      setHeader() {}
    };

    (app as unknown as { handle: (req: express.Request, res: express.Response, next: (error?: unknown) => void) => void }).handle(
      req,
      res as unknown as express.Response,
      (error: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        if (!res.headersSent) {
          resolve({ status: 404, body: null });
        }
      }
    );
  });
}

describe('results and review routes', () => {
  it('includes guest attempts in results history for the quiz owner', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        title: 'Guest Quiz',
        score: 1,
        total: 2,
        started_at: '2026-06-13T10:00:00.000Z',
        completed_at: '2026-06-13T10:02:00.000Z',
        guest_name: 'Mario',
        deleted_at: null
      }]
    });

    const response = await request('/api/results/history', {
      headers: { 'x-user-id': 'owner-1' }
    });

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('q.created_by = $1'), ['owner-1']);
    expect(response.body).toEqual([expect.objectContaining({
      id: 'attempt-1',
      quizId: 'quiz-1',
      guestName: 'Mario',
      quizTitle: 'Guest Quiz'
    })]);
  });

  it('includes guest attempts in results metrics for the quiz owner', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 'quiz-1', title: 'Guest Quiz' }]
      })
      .mockResolvedValueOnce({
        rows: [
          { quiz_id: 'quiz-1', score: 1, total: 2, completed_at: '2026-06-13T10:00:00.000Z' },
          { quiz_id: 'quiz-1', score: 2, total: 2, completed_at: '2026-06-13T11:00:00.000Z' }
        ],
        rowCount: 2
      });

    const response = await request('/api/results/metrics', {
      headers: { 'x-user-id': 'owner-1' }
    });

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenNthCalledWith(2, expect.stringContaining('WHERE q.created_by = $1'), ['owner-1']);
    expect(response.body).toEqual(expect.objectContaining({
      totalAttempts: 2,
      mostAttemptedQuiz: expect.objectContaining({ quizId: 'quiz-1', attempts: 2 }),
      bestScorePerQuiz: [expect.objectContaining({ quizId: 'quiz-1', bestScore: 100 })]
    }));
  });

  it('allows the quiz owner to open a guest attempt review', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 'attempt-1',
        quiz_id: 'quiz-1',
        answers: [
          { questionId: 'q1', selectedAnswers: [1] }
        ],
        score: 1,
        total: 1,
        started_at: '2026-06-13T10:00:00.000Z',
        completed_at: '2026-06-13T10:01:00.000Z',
        evaluations: null,
        title: 'Guest Quiz',
        topic: 'TypeScript',
        settings: {
          numQuestions: 1,
          choicesPerQuestion: 4,
          difficulty: 5,
          language: 'English',
          questionType: ['multiple_choice']
        },
        questions: [{
          id: 'q1',
          question: 'What is TS?',
          responseType: 'single_choice',
          choices: ['A', 'B', 'C', 'D'],
          correctAnswers: [1]
        }],
        pinned: false,
        deleted_at: null
      }]
    });

    const response = await request('/api/attempts/attempt-1', {
      headers: { 'x-user-id': 'owner-1' }
    });

    expect(response.status).toBe(200);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('WHERE a.id = $1 AND q.created_by = $2'), ['attempt-1', 'owner-1']);
    expect(response.body).toEqual(expect.objectContaining({
      id: 'attempt-1',
      score: 1,
      total: 1,
      quiz: expect.objectContaining({
        id: 'quiz-1',
        title: 'Guest Quiz'
      })
    }));
  });
});
