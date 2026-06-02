import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import multer from 'multer';
import { randomBytes, randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { config } from './config.js';
import { pool, runMigrations } from './db.js';
import { logger, summarizeText } from './logger.js';
import { generateQuizFromLLM } from './llm.js';
import { getSettingsForDisplay, initializeSettings, saveSettings, settingsSaveSchema } from './settings.js';
import type { QuizQuestion } from './types.js';

const app = express();
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: '1mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 10 * 1024 * 1024
  }
});

const apiLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

const generateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  limit: config.GENERATE_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});

function hasBasicAuth(): boolean {
  return Boolean(config.BASIC_AUTH_USERNAME && config.BASIC_AUTH_PASSWORD);
}

function safeCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

app.use((req, res, next) => {
  if (!hasBasicAuth()) return next();
  // Only protect /api/* routes; /public/* and static assets are always open
  if (!req.path.startsWith('/api/') || req.path === '/api/health') {
    return next();
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="learn-gpt"');
    return res.status(401).send('Authentication required');
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8');
  const separator = decoded.indexOf(':');
  const username = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';

  if (
    safeCompare(username, config.BASIC_AUTH_USERNAME ?? '') &&
    safeCompare(password, config.BASIC_AUTH_PASSWORD ?? '')
  ) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="learn-gpt"');
  return res.status(401).send('Authentication required');
});

app.use('/api', apiLimiter);

const quizSettingsSchema = z.object({
  numQuestions: z.number().int().min(1).max(100),
  choicesPerQuestion: z.number().int().min(2).max(6),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  language: z.string().trim().min(2),
  questionType: z.enum(['multiple_choice', 'true_false', 'mixed'])
}).superRefine((settings, ctx) => {
  if (settings.questionType === 'true_false' && settings.choicesPerQuestion !== 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'true_false quizzes require choicesPerQuestion = 2'
    });
  }
});

const generateQuizSchema = z.object({
  topic: z.string().trim().min(3).max(2000),
  settings: quizSettingsSchema,
  sourceText: z.string().trim().max(250_000).optional(),
  githubRepoUrl: z.string().trim().url().optional().refine(
    (url) => !url || /^https:\/\/github\.com\//i.test(url),
    { message: 'Only github.com URLs are allowed' }
  )
});

const updateQuizSchema = z.object({
  title: z.string().trim().min(1).optional(),
  pinned: z.boolean().optional()
});

const createAttemptSchema = z.object({
  quizId: z.string().uuid(),
  answers: z.array(z.number().int()),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
}).superRefine((attempt, ctx) => {
  if (new Date(attempt.completedAt).getTime() < new Date(attempt.startedAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'completedAt cannot be before startedAt'
    });
  }
});

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.__APP_CONFIG__ = ${JSON.stringify({ publicUrl: config.PUBLIC_URL })};`);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/quizzes', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, title, topic, settings, questions, created_at, pinned, pinned_at
    FROM quizzes
    ORDER BY pinned DESC, pinned_at DESC NULLS LAST, created_at DESC
  `);
  res.json(rows.map((r) => ({
    id: r.id,
    title: r.title,
    topic: r.topic,
    settings: r.settings,
    questions: r.questions,
    createdAt: r.created_at,
    pinned: r.pinned,
    pinnedAt: r.pinned_at
  })));
}));

app.post('/api/quizzes/generate', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const started = Date.now();
  try {
    let topic: unknown = req.body.topic;
    let settings: unknown = req.body.settings;
    let sourceText: unknown = req.body.sourceText;
    let githubRepoUrl: unknown = req.body.githubRepoUrl;

    if (typeof settings === 'string') {
      try {
        settings = JSON.parse(settings);
      } catch {
        return res.status(400).json({ error: 'settings must be valid JSON' });
      }
    }

    const parsed = generateQuizSchema.safeParse({
      topic,
      settings,
      sourceText: typeof sourceText === 'string' && sourceText.trim().length ? sourceText : undefined,
      githubRepoUrl: typeof githubRepoUrl === 'string' && githubRepoUrl.trim().length ? githubRepoUrl : undefined
    });
    if (!parsed.success) {
      logger.warn('quiz_generate.validation_failed', {
        issues: parsed.error.issues.map((issue) => issue.message),
        topic: summarizeText(typeof topic === 'string' ? topic : undefined)
      });
      return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    }

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    logger.info('quiz_generate.requested', {
      topic: summarizeText(parsed.data.topic),
      settings: parsed.data.settings,
      sources: {
        sourceText: summarizeText(parsed.data.sourceText),
        githubRepoUrl: parsed.data.githubRepoUrl ? 'provided' : 'none',
        documents: files.map((file) => ({
          name: file.originalname,
          mimeType: file.mimetype,
          bytes: file.size
        }))
      },
      llm: {
        style: config.LLM_API_STYLE,
        baseUrl: config.LLM_BASE_URL,
        model: config.LLM_MODEL,
        maxTokens: config.LLM_MAX_TOKENS,
        temperature: config.LLM_TEMPERATURE
      },
      retrieval: {
        embeddingStyle: config.EMBEDDING_API_STYLE,
        embeddingBaseUrl: config.EMBEDDING_BASE_URL || config.LLM_BASE_URL,
        embeddingModel: config.EMBEDDING_MODEL,
        maxRetrievedChunks: config.MAX_RETRIEVED_CHUNKS,
        maxRetrievedChars: config.MAX_RETRIEVED_CHARS,
        maxEmbeddingCandidates: config.MAX_EMBEDDING_CANDIDATES
      }
    });

    const llm = await generateQuizFromLLM(parsed.data.topic, parsed.data.settings, {
      sourceText: parsed.data.sourceText,
      githubRepoUrl: parsed.data.githubRepoUrl,
      documents: files
    });
    const id = randomUUID();
    const result = await pool.query(`
      INSERT INTO quizzes(id, title, topic, settings, questions)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
      RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at
    `, [id, llm.title, parsed.data.topic, JSON.stringify(parsed.data.settings), JSON.stringify(llm.questions)]);
    const q = result.rows[0];
    logger.info('quiz_generate.completed', {
      quizId: q.id,
      title: q.title,
      questions: q.questions.length,
      contextUsed: llm.contextUsed,
      durationMs: Date.now() - started
    });
    return res.status(201).json({
      id: q.id,
      title: q.title,
      topic: q.topic,
      settings: q.settings,
      questions: q.questions,
      createdAt: q.created_at,
      pinned: q.pinned,
      pinnedAt: q.pinned_at,
      contextUsed: llm.contextUsed
    });
  } catch (error) {
    logger.error('quiz_generate.failed', error, {
      durationMs: Date.now() - started
    });
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Quiz generation failed' });
  }
}));

app.patch('/api/quizzes/:id', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const parsed = updateQuizSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }
  const { title, pinned } = parsed.data;
  if (typeof title === 'undefined' && typeof pinned === 'undefined') {
    return res.status(400).json({ error: 'No updates requested' });
  }
  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof title !== 'undefined') {
    params.push(title);
    updates.push(`title = $${params.length}`);
  }
  if (typeof pinned !== 'undefined') {
    params.push(pinned);
    updates.push(`pinned = $${params.length}`);
    updates.push(`pinned_at = ${pinned ? 'NOW()' : 'NULL'}`);
  }
  params.push(id);
  const { rows } = await pool.query(`
    UPDATE quizzes SET ${updates.join(', ')}
    WHERE id = $${params.length}
    RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at
  `, params);
  if (!rows[0]) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  const q = rows[0];
  logger.info('quiz_updated', {
    quizId: q.id,
    fields: {
      title: typeof title !== 'undefined',
      pinned: typeof pinned !== 'undefined'
    }
  });
  return res.json({
    id: q.id,
    title: q.title,
    topic: q.topic,
    settings: q.settings,
    questions: q.questions,
    createdAt: q.created_at,
    pinned: q.pinned,
    pinnedAt: q.pinned_at
  });
}));

app.delete('/api/quizzes/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM quizzes WHERE id = $1', [req.params.id]);
  if (!rowCount) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  logger.info('quiz_deleted', { quizId: req.params.id });
  return res.status(204).send();
}));

app.post('/api/attempts', asyncRoute(async (req, res) => {
  const parsed = createAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }
  const { quizId, answers, startedAt, completedAt } = parsed.data;
  const quiz = await pool.query('SELECT questions FROM quizzes WHERE id = $1', [quizId]);
  const questions = quiz.rows[0]?.questions as QuizQuestion[] | undefined;
  if (!questions) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  if (answers.length !== questions.length) {
    return res.status(400).json({ error: 'answers length must match quiz question count' });
  }
  if (answers.some((answer, index) => answer < -1 || answer >= questions[index].choices.length)) {
    return res.status(400).json({ error: 'answers include an invalid choice index' });
  }

  const total = questions.length;
  const score = questions.reduce((sum, question, index) => (
    sum + (answers[index] === question.correctIndex ? 1 : 0)
  ), 0);
  const submittedAt = new Date();
  logger.info('attempt_submitted', {
    quizId,
    score,
    total,
    answered: answers.filter((answer) => answer >= 0).length,
    startedAt,
    completedAt,
    submittedAt: submittedAt.toISOString()
  });
  const id = randomUUID();
  const { rows } = await pool.query(`
    INSERT INTO attempts(id, quiz_id, answers, score, total, started_at, completed_at, submitted_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
    RETURNING id, quiz_id, answers, score, total, started_at, completed_at, submitted_at
  `, [id, quizId, JSON.stringify(answers), score, total, startedAt, completedAt, submittedAt]);
  const a = rows[0];
  return res.status(201).json({
    id: a.id,
    quizId: a.quiz_id,
    answers: a.answers,
    score: a.score,
    total: a.total,
    startedAt: a.started_at,
    completedAt: a.completed_at,
    submittedAt: a.submitted_at
  });
}));

app.get('/api/attempts/:id', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`
    SELECT a.id, a.quiz_id, a.answers, a.score, a.total, a.started_at, a.completed_at,
           q.title, q.topic, q.settings, q.questions, q.pinned
    FROM attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    WHERE a.id = $1
  `, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Attempt not found' });
  const r = rows[0];
  return res.json({
    id: r.id,
    quizId: r.quiz_id,
    answers: r.answers,
    score: r.score,
    total: r.total,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    timeTakenSeconds: Math.max(0, Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)),
    quiz: {
      id: r.quiz_id,
      title: r.title,
      topic: r.topic,
      settings: r.settings,
      questions: r.questions,
      pinned: r.pinned,
    }
  });
}));

app.get('/api/results/history', asyncRoute(async (req, res) => {
  const quizName = (req.query.quizName as string | undefined)?.trim().toLowerCase();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (quizName) {
    params.push(`%${quizName}%`);
    conditions.push(`LOWER(q.title) LIKE $${params.length}`);
  }
  if (from) {
    params.push(new Date(`${from}T00:00:00.000Z`));
    conditions.push(`a.completed_at >= $${params.length}`);
  }
  if (to) {
    params.push(new Date(`${to}T23:59:59.999Z`));
    conditions.push(`a.completed_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(`
    SELECT a.id, a.quiz_id, a.score, a.total, a.started_at, a.completed_at, a.guest_name, q.title
    FROM attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    ${where}
    ORDER BY a.completed_at DESC
    LIMIT 1000
  `, params);

  res.json(rows.map((r) => ({
    id: r.id,
    quizId: r.quiz_id,
    quizTitle: r.title,
    score: r.score,
    total: r.total,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    guestName: r.guest_name ?? null,
    timeTakenSeconds: Math.max(0, Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000))
  })));
}));

app.get('/api/results/metrics', asyncRoute(async (_req, res) => {
  const [quizzes, attempts] = await Promise.all([
    pool.query('SELECT id, title FROM quizzes'),
    pool.query('SELECT quiz_id, score, total, completed_at FROM attempts ORDER BY completed_at ASC')
  ]);

  const totalQuizzes = quizzes.rowCount ?? 0;
  const totalAttempts = attempts.rowCount ?? 0;
  const percentages = attempts.rows.map((a) => (a.total ? (a.score / a.total) * 100 : 0));
  const averageScore = percentages.length ? percentages.reduce((sum, p) => sum + p, 0) / percentages.length : 0;

  const bestByQuiz = new Map<string, number>();
  const countByQuiz = new Map<string, number>();
  for (const row of attempts.rows) {
    const pct = row.total ? (row.score / row.total) * 100 : 0;
    bestByQuiz.set(row.quiz_id, Math.max(bestByQuiz.get(row.quiz_id) ?? 0, pct));
    countByQuiz.set(row.quiz_id, (countByQuiz.get(row.quiz_id) ?? 0) + 1);
  }

  const quizMap = new Map(quizzes.rows.map((q) => [q.id, q.title]));
  const bestScorePerQuiz = Array.from(bestByQuiz.entries()).map(([quizId, best]) => ({ quizId, quizTitle: quizMap.get(quizId) ?? 'Unknown Quiz', bestScore: best }));
  const mostAttempted = Array.from(countByQuiz.entries()).sort((a, b) => b[1] - a[1])[0];

  const trendByQuiz = new Map<string, Array<{ completedAt: string; scorePercent: number; }>>();
  for (const row of attempts.rows) {
    const arr = trendByQuiz.get(row.quiz_id) ?? [];
    arr.push({ completedAt: row.completed_at, scorePercent: row.total ? (row.score / row.total) * 100 : 0 });
    trendByQuiz.set(row.quiz_id, arr);
  }

  res.json({
    totalQuizzes,
    totalAttempts,
    averageScore,
    bestScorePerQuiz,
    mostAttemptedQuiz: mostAttempted ? { quizId: mostAttempted[0], quizTitle: quizMap.get(mostAttempted[0]) ?? 'Unknown Quiz', attempts: mostAttempted[1] } : null,
    trendByQuiz: Object.fromEntries(Array.from(trendByQuiz.entries()).map(([quizId, trend]) => [quizId, { quizTitle: quizMap.get(quizId) ?? 'Unknown Quiz', points: trend }]))
  });
}));

app.get('/api/settings', asyncRoute(async (_req, res) => {
  const display = await getSettingsForDisplay();
  return res.json(display);
}));

app.put('/api/settings', asyncRoute(async (req, res) => {
  const parsed = settingsSaveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
  }
  await saveSettings(parsed.data);  logger.info('settings_saved', { keys: Object.keys(parsed.data) });
  const display = await getSettingsForDisplay();
  return res.json(display);
}));

const createShareSchema = z.object({
  guestName: z.string().trim().min(1).max(100),
  maxAttempts: z.number().int().min(1).max(1000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional()
});

const guestAttemptSchema = z.object({
  answers: z.array(z.number().int()),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
}).superRefine((a, ctx) => {
  if (new Date(a.completedAt).getTime() < new Date(a.startedAt).getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'completedAt cannot be before startedAt' });
  }
});

// ─── Share management (auth-protected) ───────────────────────────────────────

app.post('/api/quizzes/:id/shares', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const quiz = await pool.query('SELECT id FROM quizzes WHERE id = $1', [id]);
  if (!quiz.rows[0]) return res.status(404).json({ error: 'Quiz not found' });

  const parsed = createShareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });

  const { guestName, maxAttempts, expiresAt } = parsed.data;
  const shareId = randomUUID();
  const token = randomBytes(24).toString('base64url');

  const { rows } = await pool.query(`
    INSERT INTO quiz_shares(id, quiz_id, token, guest_name, max_attempts, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, quiz_id, token, guest_name, max_attempts, expires_at, created_at
  `, [shareId, id, token, guestName, maxAttempts ?? null, expiresAt ?? null]);

  const s = rows[0];
  logger.info('share_created', { shareId: s.id, quizId: id, guestName });
  return res.status(201).json({
    id: s.id, quizId: s.quiz_id, token: s.token,
    guestName: s.guest_name, maxAttempts: s.max_attempts,
    expiresAt: s.expires_at, createdAt: s.created_at, attemptCount: 0
  });
}));

app.get('/api/quizzes/:id/shares', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(`
    SELECT s.id, s.quiz_id, s.token, s.guest_name, s.max_attempts, s.expires_at, s.created_at,
           COUNT(a.id)::int AS attempt_count
    FROM quiz_shares s
    LEFT JOIN attempts a ON a.share_id = s.id
    WHERE s.quiz_id = $1
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `, [id]);
  return res.json(rows.map((s) => ({
    id: s.id, quizId: s.quiz_id, token: s.token,
    guestName: s.guest_name, maxAttempts: s.max_attempts,
    expiresAt: s.expires_at, createdAt: s.created_at, attemptCount: s.attempt_count
  })));
}));

app.get('/api/shares', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT s.id, s.quiz_id, s.token, s.guest_name, s.max_attempts, s.expires_at, s.created_at,
           q.title AS quiz_title,
           COUNT(a.id)::int AS attempt_count
    FROM quiz_shares s
    JOIN quizzes q ON q.id = s.quiz_id
    LEFT JOIN attempts a ON a.share_id = s.id
    GROUP BY s.id, q.title
    ORDER BY s.created_at DESC
  `);
  return res.json(rows.map((s) => ({
    id: s.id, quizId: s.quiz_id, quizTitle: s.quiz_title, token: s.token,
    guestName: s.guest_name, maxAttempts: s.max_attempts,
    expiresAt: s.expires_at, createdAt: s.created_at, attemptCount: s.attempt_count
  })));
}));

app.delete('/api/shares/:shareId', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM quiz_shares WHERE id = $1', [req.params.shareId]);
  if (!rowCount) return res.status(404).json({ error: 'Share not found' });
  logger.info('share_deleted', { shareId: req.params.shareId });
  return res.status(204).send();
}));

// ─── Public guest routes (no auth) ───────────────────────────────────────────

app.get('/public/api/s/:token', asyncRoute(async (req, res) => {
  const { token } = req.params;
  const { rows } = await pool.query(`
    SELECT s.id, s.quiz_id, s.guest_name, s.max_attempts, s.expires_at,
           q.title, q.questions,
           COUNT(a.id)::int AS attempt_count
    FROM quiz_shares s
    JOIN quizzes q ON q.id = s.quiz_id
    LEFT JOIN attempts a ON a.share_id = s.id
    WHERE s.token = $1
    GROUP BY s.id, q.title, q.questions
  `, [token]);

  if (!rows[0]) return res.status(404).json({ error: 'Share link not found' });
  const s = rows[0];

  if (s.expires_at && new Date(s.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This share link has expired' });
  }
  if (s.max_attempts !== null && s.attempt_count >= s.max_attempts) {
    return res.status(410).json({ error: 'Maximum attempts reached for this share link' });
  }

  // Strip correct answers and explanations from questions
  const publicQuestions = (s.questions as QuizQuestion[]).map(({ question, choices }) => ({ question, choices }));

  return res.json({
    shareId: s.id,
    quizId: s.quiz_id,
    title: s.title,
    guestName: s.guest_name,
    maxAttempts: s.max_attempts,
    attemptCount: s.attempt_count,
    questions: publicQuestions
  });
}));

app.post('/public/api/s/:token/attempt', asyncRoute(async (req, res) => {
  const { token } = req.params;

  // Validate body before acquiring the transaction lock
  const parsed = guestAttemptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
  const { answers, startedAt, completedAt } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the share row to prevent TOCTOU race on max_attempts (H-1)
    // FOR UPDATE cannot be used with GROUP BY, so we lock first, then count separately.
    const { rows: shareRows } = await client.query(`
      SELECT s.id, s.quiz_id, s.guest_name, s.max_attempts, s.expires_at,
             q.questions
      FROM quiz_shares s
      JOIN quizzes q ON q.id = s.quiz_id
      WHERE s.token = $1
      FOR UPDATE OF s
    `, [token]);

    if (shareRows[0]) {
      const { rows: countRows } = await client.query(
        `SELECT COUNT(id)::int AS attempt_count FROM attempts WHERE share_id = $1`,
        [shareRows[0].id]
      );
      shareRows[0].attempt_count = countRows[0].attempt_count;
    }

    if (!shareRows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Share link not found' });
    }
    const share = shareRows[0];

    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This share link has expired' });
    }
    if (share.max_attempts !== null && share.attempt_count >= share.max_attempts) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Maximum attempts reached for this share link' });
    }

    const questions = share.questions as QuizQuestion[];
    if (answers.length !== questions.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'answers length must match quiz question count' });
    }
    if (answers.some((answer, index) => answer < -1 || answer >= questions[index].choices.length)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'answers include an invalid choice index' });
    }

    const total = questions.length;
    const score = questions.reduce((sum, q, i) => sum + (answers[i] === q.correctIndex ? 1 : 0), 0);
    const submittedAt = new Date();

    const id = randomUUID();
    const { rows } = await client.query(`
      INSERT INTO attempts(id, quiz_id, answers, score, total, started_at, completed_at, submitted_at, guest_name, share_id)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, quiz_id, score, total, started_at, completed_at, submitted_at
    `, [id, share.quiz_id, JSON.stringify(answers), score, total, startedAt, completedAt, submittedAt, share.guest_name, share.id]);

    await client.query('COMMIT');

    logger.info('guest_attempt_submitted', { shareId: share.id, quizId: share.quiz_id, guestName: share.guest_name, score, total });

    const a = rows[0];
    return res.status(201).json({
      id: a.id,
      quizId: a.quiz_id,
      score: a.score,
      total: a.total,
      startedAt: a.started_at,
      completedAt: a.completed_at,
      submittedAt: a.submitted_at,
      questions: questions.map((q, i) => ({
        question: q.question,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        userAnswer: answers[i]
      }))
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '../public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/config.js') return next();
    return res.sendFile(join(publicDir, 'index.html'));
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    logger.warn('request.upload_error', {
      code: error.code,
      message: error.message
    });
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    logger.warn('request.malformed_json');
    return res.status(400).json({ error: 'Malformed JSON request body' });
  }

  logger.error('request.unhandled_error', error);
  return res.status(500).json({ error: 'Internal server error' });
});

runMigrations()
  .then(() => initializeSettings())
  .then(() => {
    if (!config.SETTINGS_ENCRYPTION_KEY) {
      logger.warn('security.encryption_key_missing', {
        message: 'SETTINGS_ENCRYPTION_KEY is not set — API keys will be stored in plaintext. Generate with: openssl rand -hex 32'
      });
    }
    app.listen(config.PORT, () => {
      logger.info('server_started', {
        port: config.PORT,
        publicUrl: config.PUBLIC_URL,
        nodeEnv: process.env.NODE_ENV ?? 'development',
        basicAuthEnabled: Boolean(config.BASIC_AUTH_USERNAME && config.BASIC_AUTH_PASSWORD),
        rateLimit: {
          windowMs: config.RATE_LIMIT_WINDOW_MS,
          maxRequests: config.RATE_LIMIT_MAX_REQUESTS,
          generateMaxRequests: config.GENERATE_RATE_LIMIT_MAX_REQUESTS
        },
        llm: {
          style: config.LLM_API_STYLE,
          baseUrl: config.LLM_BASE_URL,
          model: config.LLM_MODEL
        },
        embeddings: {
          style: config.EMBEDDING_API_STYLE,
          baseUrl: config.EMBEDDING_BASE_URL || config.LLM_BASE_URL,
          model: config.EMBEDDING_MODEL
        },
        retrieval: {
          maxRetrievedChunks: config.MAX_RETRIEVED_CHUNKS,
          maxRetrievedChars: config.MAX_RETRIEVED_CHARS,
          maxEmbeddingCandidates: config.MAX_EMBEDDING_CANDIDATES,
          embeddingBatchSize: config.EMBEDDING_BATCH_SIZE
        }
      });
    });
  })
  .catch((error) => {
    logger.error('server_start_failed', error);
    process.exit(1);
  });
