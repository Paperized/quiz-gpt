import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { pool, runMigrations } from './db.js';
import { generateQuizFromLLM } from './llm.js';
import type { QuizSettings } from './types.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const settingsSchema = {
  minQuestions: 'number',
  maxQuestions: 'number',
  choicesPerQuestion: 'number',
  difficulty: 'string',
  language: 'string',
  questionType: 'string'
};

function isValidSettings(input: unknown): input is QuizSettings {
  if (!input || typeof input !== 'object') return false;
  const data = input as Record<string, unknown>;
  return Object.entries(settingsSchema).every(([k, t]) => typeof data[k] === t);
}

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

app.post('/api/quizzes/generate', async (req, res) => {
  try {
    const { topic, settings } = req.body as { topic?: string; settings?: unknown; };
    if (!topic || !isValidSettings(settings)) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const llm = await generateQuizFromLLM(topic, settings);
    const id = randomUUID();
    const result = await pool.query(`
      INSERT INTO quizzes(id, title, topic, settings, questions)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
      RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at
    `, [id, llm.title, topic, JSON.stringify(settings), JSON.stringify(llm.questions)]);
    const q = result.rows[0];
    return res.status(201).json({
      id: q.id,
      title: q.title,
      topic: q.topic,
      settings: q.settings,
      questions: q.questions,
      createdAt: q.created_at,
      pinned: q.pinned,
      pinnedAt: q.pinned_at
    });
  } catch (error) {
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Quiz generation failed' });
  }
});

app.patch('/api/quizzes/:id', async (req, res) => {
  const { id } = req.params;
  const { title, pinned } = req.body as { title?: string; pinned?: boolean; };
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
  const { quizId, answers, score, total, startedAt, completedAt } = req.body as {
    quizId?: string;
    answers?: number[];
    score?: number;
    total?: number;
    startedAt?: string;
    completedAt?: string;
  };
  if (!quizId || !Array.isArray(answers) || typeof score !== 'number' || typeof total !== 'number' || !startedAt || !completedAt) {
    return res.status(400).json({ error: 'Invalid attempt payload' });
  }
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

  const { rows } = await pool.query(`
    SELECT a.id, a.quiz_id, a.score, a.total, a.started_at, a.completed_at, q.title
    FROM attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    ORDER BY a.completed_at DESC
  `);

  const filtered = rows.filter((r) => {
    if (quizName && !r.title.toLowerCase().includes(quizName)) return false;
    if (from && new Date(r.completed_at) < new Date(from)) return false;
    if (to && new Date(r.completed_at) > new Date(to)) return false;
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
