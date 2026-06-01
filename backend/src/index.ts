import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { pool, runMigrations } from './db.js';
import { generateQuizFromLLM } from './llm.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 8,
    fileSize: 10 * 1024 * 1024
  }
});

const quizSettingsSchema = z.object({
  minQuestions: z.number().int().min(1).max(100),
  maxQuestions: z.number().int().min(1).max(100),
  choicesPerQuestion: z.number().int().min(2).max(6),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  language: z.string().trim().min(2),
  questionType: z.enum(['multiple_choice', 'true_false', 'mixed'])
}).superRefine((settings, ctx) => {
  if (settings.minQuestions > settings.maxQuestions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minQuestions cannot be greater than maxQuestions'
    });
  }
  if (settings.questionType === 'true_false' && settings.choicesPerQuestion !== 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'true_false quizzes require choicesPerQuestion = 2'
    });
  }
});

const generateQuizSchema = z.object({
  topic: z.string().trim().min(3),
  settings: quizSettingsSchema,
  sourceText: z.string().trim().max(250_000).optional(),
  githubRepoUrl: z.string().trim().url().optional()
});

const updateQuizSchema = z.object({
  title: z.string().trim().min(1).optional(),
  pinned: z.boolean().optional()
});

const createAttemptSchema = z.object({
  quizId: z.string().uuid(),
  answers: z.array(z.number().int()),
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime()
}).superRefine((attempt, ctx) => {
  if (attempt.score > attempt.total) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'score cannot be greater than total'
    });
  }
  if (attempt.answers.length !== attempt.total) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'answers length must match total'
    });
  }
});

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.__APP_CONFIG__ = ${JSON.stringify({ publicUrl: config.PUBLIC_URL })};`);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/quizzes', async (_req, res) => {
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
});

app.post('/api/quizzes/generate', upload.array('documents', 8), async (req, res) => {
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
      return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    }
    const llm = await generateQuizFromLLM(parsed.data.topic, parsed.data.settings, {
      sourceText: parsed.data.sourceText,
      githubRepoUrl: parsed.data.githubRepoUrl,
      documents: req.files as Express.Multer.File[] | undefined
    });
    const id = randomUUID();
    const result = await pool.query(`
      INSERT INTO quizzes(id, title, topic, settings, questions)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
      RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at
    `, [id, llm.title, parsed.data.topic, JSON.stringify(parsed.data.settings), JSON.stringify(llm.questions)]);
    const q = result.rows[0];
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
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Quiz generation failed' });
  }
});

app.patch('/api/quizzes/:id', async (req, res) => {
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
});

app.delete('/api/quizzes/:id', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM quizzes WHERE id = $1', [req.params.id]);
  if (!rowCount) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  return res.status(204).send();
});

app.post('/api/attempts', async (req, res) => {
  const parsed = createAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }
  const { quizId, answers, score, total, startedAt, completedAt } = parsed.data;
  const id = randomUUID();
  const { rows } = await pool.query(`
    INSERT INTO attempts(id, quiz_id, answers, score, total, started_at, completed_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
    RETURNING id, quiz_id, answers, score, total, started_at, completed_at
  `, [id, quizId, JSON.stringify(answers), score, total, startedAt, completedAt]);
  const a = rows[0];
  return res.status(201).json({
    id: a.id,
    quizId: a.quiz_id,
    answers: a.answers,
    score: a.score,
    total: a.total,
    startedAt: a.started_at,
    completedAt: a.completed_at
  });
});

app.get('/api/results/history', async (req, res) => {
  const quizName = (req.query.quizName as string | undefined)?.toLowerCase();
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
  const toDate = to ? new Date(`${to}T23:59:59.999Z`) : null;

  const { rows } = await pool.query(`
    SELECT a.id, a.quiz_id, a.score, a.total, a.started_at, a.completed_at, q.title
    FROM attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    ORDER BY a.completed_at DESC
  `);

  const filtered = rows.filter((r) => {
    if (quizName && !r.title.toLowerCase().includes(quizName)) return false;
    if (fromDate && new Date(r.completed_at) < fromDate) return false;
    if (toDate && new Date(r.completed_at) > toDate) return false;
    return true;
  });

  res.json(filtered.map((r) => ({
    id: r.id,
    quizId: r.quiz_id,
    quizTitle: r.title,
    score: r.score,
    total: r.total,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    timeTakenSeconds: Math.max(0, Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000))
  })));
});

app.get('/api/results/metrics', async (_req, res) => {
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
});

const publicDir = join(process.cwd(), 'backend/public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/config.js') return next();
    return res.sendFile(join(publicDir, 'index.html'));
  });
}

runMigrations()
  .then(() => {
    app.listen(config.PORT, () => {
      console.log(`Server running on ${config.PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to start:', error);
    process.exit(1);
  });
