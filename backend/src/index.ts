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
import { generateQuizFromLLM, proposeGroupQuizFromLLM } from './llm.js';
import { normalizeAttemptAnswers, scoreAttempt } from './scoring.js';
import { getSettingsForDisplay, initializeSettings, saveSettings, settingsSaveSchema } from './settings.js';
import type { AttemptAnswer, QuizQuestion, QuizSettings } from './types.js';

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

const apiLimiter = config.RATE_LIMIT_MAX_REQUESTS > 0
  ? rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-7',
      legacyHeaders: false
    })
  : (_req: Request, _res: Response, next: NextFunction) => next();

const generateLimiter = config.GENERATE_RATE_LIMIT_MAX_REQUESTS > 0
  ? rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.GENERATE_RATE_LIMIT_MAX_REQUESTS,
      standardHeaders: 'draft-7',
      legacyHeaders: false
    })
  : (_req: Request, _res: Response, next: NextFunction) => next();

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
    res.setHeader('WWW-Authenticate', 'Basic realm="quiz-gpt"');
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

  res.setHeader('WWW-Authenticate', 'Basic realm="quiz-gpt"');
  return res.status(401).send('Authentication required');
});

app.use('/api', apiLimiter);

const quizSettingsSchema = z.object({
  numQuestions: z.number().int().min(1).max(100),
  choicesPerQuestion: z.number().int().min(2).max(6),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  language: z.string().trim().min(2),
  questionType: z.enum(['multiple_choice', 'true_false', 'mixed', 'multi_select'])
}).superRefine((settings, ctx) => {
  if (settings.questionType === 'true_false' && settings.choicesPerQuestion !== 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'true_false quizzes require choicesPerQuestion = 2'
    });
  }
  if (settings.questionType === 'multi_select' && settings.choicesPerQuestion < 4) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'multi_select quizzes require choicesPerQuestion >= 4'
    });
  }
});

const generateQuizSchema = z.object({
  topic: z.string().trim().min(3),
  settings: quizSettingsSchema,
  sourceText: z.string().trim().max(250_000).optional(),
  githubRepoUrl: z.string().trim().url().optional().refine(
    (url) => !url || /^https:\/\/github\.com\//i.test(url),
    { message: 'Only github.com URLs are allowed' }
  )
});

const groupProposalRequestSchema = generateQuizSchema.extend({
  minQuizCount: z.coerce.number().int().min(1).max(8),
  maxQuizCount: z.coerce.number().int().min(1).max(8)
}).superRefine((payload, ctx) => {
  if (payload.minQuizCount > payload.maxQuizCount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minQuizCount cannot be greater than maxQuizCount'
    });
  }
});

const groupQuizItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  focus: z.string().trim().min(1).max(2000)
});

const groupGenerateRequestSchema = generateQuizSchema.extend({
  groupTitle: z.string().trim().min(1).max(100),
  items: z.array(groupQuizItemSchema).min(1).max(8)
});

const updateQuizSchema = z.object({
  title: z.string().trim().min(1).optional(),
  pinned: z.boolean().optional(),
  groupId: z.string().uuid().nullable().optional()
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100)
});

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  position: z.number().int().min(0).optional()
});

const regenerateSchema = z.object({
  settings: quizSettingsSchema.optional(),
  prompt: z.string().trim().max(2000).optional(),
  mode: z.enum(['overwrite', 'duplicate'])
});

const attemptAnswerSchema = z.object({
  questionId: z.string().uuid(),
  selectedAnswers: z.array(z.number().int().nonnegative())
});

const createAttemptSchema = z.object({
  quizId: z.string().uuid(),
  answers: z.array(attemptAnswerSchema),
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

type ParsedSourceRequest = z.infer<typeof generateQuizSchema> & {
  files: Express.Multer.File[];
};

type JobKind =
  | 'quiz_generate'
  | 'group_propose'
  | 'group_generate'
  | 'quiz_regenerate'
  | 'group_regenerate';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

type GenerationJob = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  currentStep: string;
  stepIndex: number;
  stepTotal: number;
  doneCount: number | null;
  totalCount: number | null;
  message: string | null;
  resultPayload: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobProgressUpdate = Partial<Pick<GenerationJob, 'status' | 'currentStep' | 'stepIndex' | 'stepTotal' | 'doneCount' | 'totalCount' | 'message' | 'resultPayload' | 'error'>>;

const generationJobs = new Map<string, GenerationJob>();
const STANDARD_STEP_TOTAL = 6;

function nowIso() {
  return new Date().toISOString();
}

function createGenerationJob(kind: JobKind, initial?: Partial<Pick<GenerationJob, 'currentStep' | 'stepIndex' | 'stepTotal' | 'doneCount' | 'totalCount' | 'message'>>) {
  const timestamp = nowIso();
  const job: GenerationJob = {
    id: randomUUID(),
    kind,
    status: 'queued',
    currentStep: initial?.currentStep ?? 'Validating request',
    stepIndex: initial?.stepIndex ?? 1,
    stepTotal: initial?.stepTotal ?? STANDARD_STEP_TOTAL,
    doneCount: typeof initial?.doneCount === 'number' ? initial.doneCount : null,
    totalCount: typeof initial?.totalCount === 'number' ? initial.totalCount : null,
    message: initial?.message ?? null,
    resultPayload: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  generationJobs.set(job.id, job);
  return job;
}

function updateGenerationJob(jobId: string, patch: JobProgressUpdate) {
  const job = generationJobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: nowIso() });
}

function failGenerationJob(jobId: string, error: unknown) {
  updateGenerationJob(jobId, {
    status: 'failed',
    error: error instanceof Error ? error.message : 'Unknown error',
    message: null
  });
}

function getGenerationJob(jobId: string) {
  return generationJobs.get(jobId) ?? null;
}

function startGenerationJob<T>(job: GenerationJob, runner: () => Promise<T>) {
  void (async () => {
    updateGenerationJob(job.id, { status: 'running' });
    try {
      const result = await runner();
      updateGenerationJob(job.id, {
        status: 'completed',
        currentStep: 'Completed',
        stepIndex: job.stepTotal,
        doneCount: job.totalCount,
        message: null,
        resultPayload: result,
        error: null
      });
    } catch (error) {
      failGenerationJob(job.id, error);
    }
  })();
}

function parseJsonField<T>(value: unknown, fieldName: string): T | { error: string; } {
  if (typeof value !== 'string') {
    return { error: `${fieldName} must be valid JSON` };
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return { error: `${fieldName} must be valid JSON` };
  }
}

function mapQuizRow(row: {
  id: string;
  title: string;
  topic: string;
  settings: QuizSettings;
  questions: QuizQuestion[];
  created_at: string;
  pinned: boolean;
  pinned_at: string | null;
  group_id: string | null;
}) {
  return {
    id: row.id,
    title: row.title,
    topic: row.topic,
    settings: row.settings,
    questions: row.questions,
    createdAt: row.created_at,
    pinned: row.pinned,
    pinnedAt: row.pinned_at,
    groupId: row.group_id
  };
}

function parseSourceGenerationRequest(req: Request): ParsedSourceRequest | { error: string; topic?: string; } {
  const settingsValue = typeof req.body.settings === 'string'
    ? parseJsonField<QuizSettings>(req.body.settings, 'settings')
    : req.body.settings;
  if ('error' in (settingsValue as { error?: string; })) {
    return { error: (settingsValue as { error: string; }).error, topic: typeof req.body.topic === 'string' ? req.body.topic : undefined };
  }

  const parsed = generateQuizSchema.safeParse({
    topic: req.body.topic,
    settings: settingsValue,
    sourceText: typeof req.body.sourceText === 'string' && req.body.sourceText.trim().length ? req.body.sourceText : undefined,
    githubRepoUrl: typeof req.body.githubRepoUrl === 'string' && req.body.githubRepoUrl.trim().length ? req.body.githubRepoUrl : undefined
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join('; '), topic: typeof req.body.topic === 'string' ? req.body.topic : undefined };
  }

  return {
    ...parsed.data,
    files: (req.files as Express.Multer.File[] | undefined) ?? []
  };
}

type GroupQuizGenerationError = {
  itemTitle: string;
  message: string;
};

async function createQuizFromGenerationRequest(
  parsed: ParsedSourceRequest,
  onProgress?: (update: JobProgressUpdate) => void
) {
  onProgress?.({ currentStep: 'Preparing sources', stepIndex: 2, message: null });
  const llm = await generateQuizFromLLM(
    parsed.topic,
    parsed.settings,
    {
      sourceText: parsed.sourceText,
      githubRepoUrl: parsed.githubRepoUrl,
      documents: parsed.files
    },
    undefined,
    undefined,
    {
      onProgress: (step) => onProgress?.({ currentStep: step, stepIndex: step === 'Validating output' ? 5 : step === 'Calling model' ? 4 : 3 })
    }
  );
  onProgress?.({ currentStep: 'Saving result', stepIndex: 6, message: null });
  const id = randomUUID();
  const result = await pool.query(`
    INSERT INTO quizzes(id, title, topic, settings, questions)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
    RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id
  `, [id, llm.title, parsed.topic, JSON.stringify(parsed.settings), JSON.stringify(llm.questions)]);
  const q = result.rows[0];
  return { ...mapQuizRow(q), contextUsed: llm.contextUsed };
}

async function createGroupProposal(
  parsed: ParsedSourceRequest,
  minQuizCount: number,
  maxQuizCount: number,
  onProgress?: (update: JobProgressUpdate) => void
) {
  onProgress?.({ currentStep: 'Preparing sources', stepIndex: 2, message: null });
  const proposal = await proposeGroupQuizFromLLM(
    parsed.topic,
    parsed.settings,
    {
      sourceText: parsed.sourceText,
      githubRepoUrl: parsed.githubRepoUrl,
      documents: parsed.files
    },
    minQuizCount,
    maxQuizCount,
    {
      onProgress: (step) => onProgress?.({ currentStep: step, stepIndex: step === 'Validating output' ? 5 : step === 'Calling model' ? 4 : 3 })
    }
  );
  onProgress?.({ currentStep: 'Saving result', stepIndex: 6, message: null });
  return {
    groupTitle: proposal.groupTitle,
    items: proposal.items
  };
}

async function createGroupQuiz(
  parsed: z.infer<typeof groupGenerateRequestSchema>,
  files: Express.Multer.File[],
  onProgress?: (update: JobProgressUpdate) => void
) {
  let completedCount = 0;
  onProgress?.({
    currentStep: 'Preparing sources',
    stepIndex: 2,
    doneCount: 0,
    totalCount: parsed.items.length,
    message: null
  });
  const { rows: maxPosRows } = await pool.query('SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM quiz_groups');
  const position = maxPosRows[0].max_pos + 1;
  const { rows: groupRows } = await pool.query(
    'INSERT INTO quiz_groups(name, position) VALUES ($1, $2) RETURNING id, name, position, created_at',
    [parsed.groupTitle, position]
  );
  const group = groupRows[0];

  const generationResults = await Promise.allSettled(parsed.items.map(async (item, index) => {
    const itemLabel = `Generating quiz ${index + 1}/${parsed.items.length}`;
    const llm = await generateQuizFromLLM(
      `${parsed.topic}\n\nQuiz title: ${item.title}\nQuiz focus: ${item.focus}`,
      parsed.settings,
      {
        sourceText: parsed.sourceText,
        githubRepoUrl: parsed.githubRepoUrl,
        documents: files
      },
      undefined,
      undefined,
      {
        onProgress: (step) => onProgress?.({
          currentStep: itemLabel,
          stepIndex: step === 'Validating output' ? 5 : step === 'Calling model' ? 4 : 3,
          doneCount: completedCount,
          totalCount: parsed.items.length,
          message: step
        })
      }
    );
    onProgress?.({
      currentStep: 'Saving result',
      stepIndex: 6,
      doneCount: completedCount,
      totalCount: parsed.items.length,
      message: `Saving quiz ${index + 1}/${parsed.items.length}`
    });
    const quizId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO quizzes(id, title, topic, settings, questions, group_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
      [
        quizId,
        item.title,
        `${parsed.topic}\n\n${item.focus}`,
        JSON.stringify(parsed.settings),
        JSON.stringify(llm.questions),
        group.id
      ]
    );
    completedCount += 1;
    onProgress?.({
      currentStep: completedCount >= parsed.items.length ? 'Saving result' : `Generating quiz ${completedCount + 1}/${parsed.items.length}`,
      stepIndex: 3,
      doneCount: completedCount,
      totalCount: parsed.items.length,
      message: null
    });
    return rows[0];
  }));

  const quizzes = generationResults
    .filter((entry): entry is PromiseFulfilledResult<{
      id: string;
      title: string;
      topic: string;
      settings: QuizSettings;
      questions: QuizQuestion[];
      created_at: string;
      pinned: boolean;
      pinned_at: string | null;
      group_id: string | null;
    }> => entry.status === 'fulfilled')
    .map((entry) => mapQuizRow(entry.value));
  const errors = generationResults
    .flatMap((entry, index) => entry.status === 'rejected'
      ? [{
          itemTitle: parsed.items[index].title,
          message: entry.reason instanceof Error ? entry.reason.message : 'unknown error'
        }]
      : []);

  if (quizzes.length === 0) {
    await pool.query('DELETE FROM quiz_groups WHERE id = $1', [group.id]);
    throw new Error(errors[0]?.message ?? 'All group quiz items failed to generate');
  }

  return {
    groupId: group.id,
    quizzes,
    errors
  };
}

async function regenerateQuiz(
  quizId: string,
  payload: z.infer<typeof regenerateSchema>,
  onProgress?: (update: JobProgressUpdate) => void
) {
  const { rows } = await pool.query(
    'SELECT id, title, topic, settings, questions, group_id FROM quizzes WHERE id = $1 AND deleted_at IS NULL',
    [quizId]
  );
  if (!rows[0]) {
    throw new Error('Quiz not found');
  }

  const quiz = rows[0];
  const settings = payload.settings ?? (quiz.settings as QuizSettings);
  const existingQuestions = quiz.questions as QuizQuestion[];

  onProgress?.({ currentStep: 'Preparing sources', stepIndex: 2, message: null });
  const llm = await generateQuizFromLLM(
    quiz.topic,
    settings,
    {},
    existingQuestions,
    payload.prompt,
    {
      onProgress: (step) => onProgress?.({ currentStep: step, stepIndex: step === 'Validating output' ? 5 : step === 'Calling model' ? 4 : 3 })
    }
  );

  onProgress?.({ currentStep: 'Saving result', stepIndex: 6, message: null });
  if (payload.mode === 'overwrite') {
    const { rows: updated } = await pool.query(
      `UPDATE quizzes SET title = $1, settings = $2::jsonb, questions = $3::jsonb
       WHERE id = $4
       RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
      [llm.title, JSON.stringify(settings), JSON.stringify(llm.questions), quizId]
    );
    return { ...mapQuizRow(updated[0]), contextUsed: llm.contextUsed };
  }

  const newId = randomUUID();
  const { rows: inserted } = await pool.query(
    `INSERT INTO quizzes(id, title, topic, settings, questions, group_id)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
     RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
    [newId, llm.title, quiz.topic, JSON.stringify(settings), JSON.stringify(llm.questions), quiz.group_id]
  );
  return { ...mapQuizRow(inserted[0]), contextUsed: llm.contextUsed };
}

async function regenerateGroup(
  groupId: string,
  payload: z.infer<typeof regenerateSchema>,
  onProgress?: (update: JobProgressUpdate) => void
) {
  if (!payload.settings) {
    throw new Error('settings is required for group regeneration');
  }

  const group = await pool.query('SELECT id, name FROM quiz_groups WHERE id = $1', [groupId]);
  if (!group.rows[0]) {
    throw new Error('Group not found');
  }

  const { rows: quizzes } = await pool.query(
    'SELECT id, title, topic, questions FROM quizzes WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
    [groupId]
  );
  if (quizzes.length === 0) {
    throw new Error('Group has no quizzes');
  }

  let targetGroupId: string = groupId;
  let completedCount = 0;
  onProgress?.({
    currentStep: 'Preparing sources',
    stepIndex: 2,
    doneCount: 0,
    totalCount: quizzes.length,
    message: null
  });

  if (payload.mode === 'duplicate') {
    const { rows: maxPos } = await pool.query('SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM quiz_groups');
    const position = maxPos[0].max_pos + 1;
    const newName = `${group.rows[0].name} Regen`;
    const { rows: newGroup } = await pool.query(
      'INSERT INTO quiz_groups(name, position) VALUES ($1, $2) RETURNING id',
      [newName, position]
    );
    targetGroupId = newGroup[0].id;
  }

  const results = await Promise.allSettled(quizzes.map(async (quiz, index) => {
    const existingQuestions = quiz.questions as QuizQuestion[];
    const itemLabel = `Generating quiz ${index + 1}/${quizzes.length}`;
    const llm = await generateQuizFromLLM(
      quiz.topic,
      payload.settings!,
      {},
      existingQuestions,
      payload.prompt,
      {
        onProgress: (step) => onProgress?.({
          currentStep: itemLabel,
          stepIndex: step === 'Validating output' ? 5 : step === 'Calling model' ? 4 : 3,
          doneCount: completedCount,
          totalCount: quizzes.length,
          message: step
        })
      }
    );

    onProgress?.({
      currentStep: 'Saving result',
      stepIndex: 6,
      doneCount: completedCount,
      totalCount: quizzes.length,
      message: `Saving quiz ${index + 1}/${quizzes.length}`
    });
    if (payload.mode === 'overwrite') {
      const { rows } = await pool.query(
        `UPDATE quizzes SET title = $1, settings = $2::jsonb, questions = $3::jsonb WHERE id = $4
         RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
        [llm.title, JSON.stringify(payload.settings), JSON.stringify(llm.questions), quiz.id]
      );
      completedCount += 1;
      onProgress?.({
        currentStep: completedCount >= quizzes.length ? 'Saving result' : `Generating quiz ${completedCount + 1}/${quizzes.length}`,
        stepIndex: 3,
        doneCount: completedCount,
        totalCount: quizzes.length,
        message: null
      });
      return rows[0];
    }

    const newId = randomUUID();
    const { rows } = await pool.query(
      `INSERT INTO quizzes(id, title, topic, settings, questions, group_id)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
       RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
      [newId, llm.title, quiz.topic, JSON.stringify(payload.settings), JSON.stringify(llm.questions), targetGroupId]
    );
    completedCount += 1;
    onProgress?.({
      currentStep: completedCount >= quizzes.length ? 'Saving result' : `Generating quiz ${completedCount + 1}/${quizzes.length}`,
      stepIndex: 3,
      doneCount: completedCount,
      totalCount: quizzes.length,
      message: null
    });
    return rows[0];
  }));

  const succeeded: Array<{ value: { id: string; title: string; topic: string; settings: QuizSettings; questions: QuizQuestion[]; created_at: string; pinned: boolean; pinned_at: string | null; group_id: string | null } }> = [];
  const failed: Array<{ reason: unknown }> = [];
  for (const result of results) {
    if (result.status === 'fulfilled') succeeded.push(result);
    else failed.push(result);
  }

  if (failed.length > 0 && succeeded.length === 0) {
    throw new Error(`All ${quizzes.length} quizzes failed to regenerate. First error: ${failed[0].reason instanceof Error ? failed[0].reason.message : 'unknown'}`);
  }

  return {
    groupId: targetGroupId,
    quizzes: succeeded.map((entry) => mapQuizRow(entry.value)),
    errors: failed.map((entry) => entry.reason instanceof Error ? entry.reason.message : 'unknown error')
  };
}

app.get('/config.js', (_req, res) => {
  res.type('application/javascript').send(`window.__APP_CONFIG__ = ${JSON.stringify({ publicUrl: config.PUBLIC_URL })};`);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/jobs/:id', asyncRoute(async (req, res) => {
  const job = getGenerationJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.json(job);
}));

app.post('/api/jobs/quizzes/generate', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const parsed = parseSourceGenerationRequest(req);
  if ('error' in parsed) {
    logger.warn('quiz_generate.validation_failed', {
      error: parsed.error,
      topic: summarizeText(parsed.topic)
    });
    return res.status(400).json({ error: parsed.error });
  }

  const job = createGenerationJob('quiz_generate');
  logger.info('quiz_generate.job_requested', {
    jobId: job.id,
    topic: summarizeText(parsed.topic)
  });
  startGenerationJob(job, async () => {
    const started = Date.now();
    logger.info('quiz_generate.requested', {
      jobId: job.id,
      topic: summarizeText(parsed.topic),
      settings: parsed.settings,
      sources: {
        sourceText: summarizeText(parsed.sourceText),
        githubRepoUrl: parsed.githubRepoUrl ? 'provided' : 'none',
        documents: parsed.files.map((file) => ({
          name: file.originalname,
          mimeType: file.mimetype,
          bytes: file.size
        }))
      }
    });
    const result = await createQuizFromGenerationRequest(parsed, (update) => updateGenerationJob(job.id, update));
    logger.info('quiz_generate.completed', {
      jobId: job.id,
      quizId: result.id,
      title: result.title,
      questions: result.questions.length,
      contextUsed: result.contextUsed,
      durationMs: Date.now() - started
    });
    return result;
  });
  return res.status(202).json({ jobId: job.id });
}));

app.post('/api/jobs/group-quizzes/propose', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const sourceParsed = parseSourceGenerationRequest(req);
  if ('error' in sourceParsed) {
    logger.warn('group_quiz_propose.validation_failed', {
      error: sourceParsed.error,
      topic: summarizeText(sourceParsed.topic)
    });
    return res.status(400).json({ error: sourceParsed.error });
  }

  const proposalParsed = groupProposalRequestSchema.safeParse({
    topic: sourceParsed.topic,
    settings: sourceParsed.settings,
    sourceText: sourceParsed.sourceText,
    githubRepoUrl: sourceParsed.githubRepoUrl,
    minQuizCount: req.body.minQuizCount,
    maxQuizCount: req.body.maxQuizCount
  });
  if (!proposalParsed.success) {
    return res.status(400).json({ error: proposalParsed.error.issues.map((issue) => issue.message).join('; ') });
  }

  const job = createGenerationJob('group_propose');
  startGenerationJob(job, async () => {
    const result = await createGroupProposal(
      sourceParsed,
      proposalParsed.data.minQuizCount,
      proposalParsed.data.maxQuizCount,
      (update) => updateGenerationJob(job.id, update)
    );
    logger.info('group_quiz_propose.completed', {
      jobId: job.id,
      groupTitle: result.groupTitle,
      items: result.items.length
    });
    return result;
  });
  return res.status(202).json({ jobId: job.id });
}));

app.post('/api/jobs/group-quizzes/generate', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const sourceParsed = parseSourceGenerationRequest(req);
  if ('error' in sourceParsed) {
    logger.warn('group_quiz_generate.validation_failed', {
      error: sourceParsed.error,
      topic: summarizeText(sourceParsed.topic)
    });
    return res.status(400).json({ error: sourceParsed.error });
  }

  const itemsValue = parseJsonField<Array<{ title: string; focus: string; }>>(req.body.items, 'items');
  if ('error' in itemsValue) {
    return res.status(400).json({ error: itemsValue.error });
  }

  const parsed = groupGenerateRequestSchema.safeParse({
    topic: sourceParsed.topic,
    settings: sourceParsed.settings,
    sourceText: sourceParsed.sourceText,
    githubRepoUrl: sourceParsed.githubRepoUrl,
    groupTitle: req.body.groupTitle,
    items: itemsValue
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }

  const job = createGenerationJob('group_generate', {
    totalCount: parsed.data.items.length,
    doneCount: 0
  });
  startGenerationJob(job, async () => {
    const result = await createGroupQuiz(parsed.data, sourceParsed.files, (update) => updateGenerationJob(job.id, update));
    logger.info('group_quiz_generate.completed', {
      jobId: job.id,
      groupId: result.groupId,
      total: parsed.data.items.length,
      succeeded: result.quizzes.length,
      failed: result.errors.length
    });
    return result;
  });
  return res.status(202).json({ jobId: job.id });
}));

app.post('/api/jobs/quizzes/:id/regenerate', generateLimiter, asyncRoute(async (req, res) => {
  const parsed = regenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }

  const job = createGenerationJob('quiz_regenerate');
  startGenerationJob(job, async () => {
    const started = Date.now();
    const result = await regenerateQuiz(req.params.id, parsed.data, (update) => updateGenerationJob(job.id, update));
    logger.info(`quiz_regenerated.${parsed.data.mode}`, {
      jobId: job.id,
      quizId: result.id,
      durationMs: Date.now() - started
    });
    return result;
  });
  return res.status(202).json({ jobId: job.id });
}));

app.post('/api/jobs/groups/:id/regenerate', generateLimiter, asyncRoute(async (req, res) => {
  const parsed = regenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }
  if (!parsed.data.settings) {
    return res.status(400).json({ error: 'settings is required for group regeneration' });
  }

  const group = await pool.query(
    'SELECT COUNT(*)::int AS quiz_count FROM quizzes WHERE group_id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  const totalCount = group.rows[0]?.quiz_count ?? 0;
  const job = createGenerationJob('group_regenerate', {
    totalCount: totalCount || null,
    doneCount: 0
  });
  startGenerationJob(job, async () => {
    const started = Date.now();
    const result = await regenerateGroup(req.params.id, parsed.data, (update) => updateGenerationJob(job.id, update));
    logger.info('group_regenerate.completed', {
      jobId: job.id,
      groupId: req.params.id,
      mode: parsed.data.mode,
      targetGroupId: result.groupId,
      total: totalCount,
      succeeded: result.quizzes.length,
      failed: result.errors.length,
      durationMs: Date.now() - started
    });
    return result;
  });
  return res.status(202).json({ jobId: job.id });
}));

app.get('/api/quizzes', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id
    FROM quizzes
    WHERE deleted_at IS NULL
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
    pinnedAt: r.pinned_at,
    groupId: r.group_id
  })));
}));

app.post('/api/quizzes/generate', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const started = Date.now();
  try {
    const parsed = parseSourceGenerationRequest(req);
    if ('error' in parsed) {
      logger.warn('quiz_generate.validation_failed', {
        error: parsed.error,
        topic: summarizeText(parsed.topic)
      });
      return res.status(400).json({ error: parsed.error });
    }

    logger.info('quiz_generate.requested', {
      topic: summarizeText(parsed.topic),
      settings: parsed.settings,
      sources: {
        sourceText: summarizeText(parsed.sourceText),
        githubRepoUrl: parsed.githubRepoUrl ? 'provided' : 'none',
        documents: parsed.files.map((file) => ({
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
      },
      scoring: {
        multiSelectPenaltyAlpha: config.MULTI_SELECT_PENALTY_ALPHA
      }
    });

    const llm = await generateQuizFromLLM(parsed.topic, parsed.settings, {
      sourceText: parsed.sourceText,
      githubRepoUrl: parsed.githubRepoUrl,
      documents: parsed.files
    });
    const id = randomUUID();
    const result = await pool.query(`
      INSERT INTO quizzes(id, title, topic, settings, questions)
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
      RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id
    `, [id, llm.title, parsed.topic, JSON.stringify(parsed.settings), JSON.stringify(llm.questions)]);
    const q = result.rows[0];
    logger.info('quiz_generate.completed', {
      quizId: q.id,
      title: q.title,
      questions: q.questions.length,
      contextUsed: llm.contextUsed,
      durationMs: Date.now() - started
    });
    return res.status(201).json({ ...mapQuizRow(q), contextUsed: llm.contextUsed });
  } catch (error) {
    logger.error('quiz_generate.failed', error, {
      durationMs: Date.now() - started
    });
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Quiz generation failed' });
  }
}));

app.post('/api/group-quizzes/propose', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const sourceParsed = parseSourceGenerationRequest(req);
  if ('error' in sourceParsed) {
    logger.warn('group_quiz_propose.validation_failed', {
      error: sourceParsed.error,
      topic: summarizeText(sourceParsed.topic)
    });
    return res.status(400).json({ error: sourceParsed.error });
  }

  const proposalParsed = groupProposalRequestSchema.safeParse({
    topic: sourceParsed.topic,
    settings: sourceParsed.settings,
    sourceText: sourceParsed.sourceText,
    githubRepoUrl: sourceParsed.githubRepoUrl,
    minQuizCount: req.body.minQuizCount,
    maxQuizCount: req.body.maxQuizCount
  });
  if (!proposalParsed.success) {
    return res.status(400).json({ error: proposalParsed.error.issues.map((issue) => issue.message).join('; ') });
  }

  try {
    const proposal = await proposeGroupQuizFromLLM(
      proposalParsed.data.topic,
      proposalParsed.data.settings,
      {
        sourceText: proposalParsed.data.sourceText,
        githubRepoUrl: proposalParsed.data.githubRepoUrl,
        documents: sourceParsed.files
      },
      proposalParsed.data.minQuizCount,
      proposalParsed.data.maxQuizCount
    );

    return res.status(201).json({
      groupTitle: proposal.groupTitle,
      items: proposal.items
    });
  } catch (error) {
    logger.error('group_quiz_propose.failed', error, {
      topic: summarizeText(sourceParsed.topic)
    });
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Group proposal failed' });
  }
}));

app.post('/api/group-quizzes/generate', generateLimiter, upload.array('documents', 8), asyncRoute(async (req, res) => {
  const sourceParsed = parseSourceGenerationRequest(req);
  if ('error' in sourceParsed) {
    logger.warn('group_quiz_generate.validation_failed', {
      error: sourceParsed.error,
      topic: summarizeText(sourceParsed.topic)
    });
    return res.status(400).json({ error: sourceParsed.error });
  }

  const itemsValue = parseJsonField<Array<{ title: string; focus: string; }>>(req.body.items, 'items');
  if ('error' in itemsValue) {
    return res.status(400).json({ error: itemsValue.error });
  }

  const parsed = groupGenerateRequestSchema.safeParse({
    topic: sourceParsed.topic,
    settings: sourceParsed.settings,
    sourceText: sourceParsed.sourceText,
    githubRepoUrl: sourceParsed.githubRepoUrl,
    groupTitle: req.body.groupTitle,
    items: itemsValue
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }

  try {
    const { rows: maxPosRows } = await pool.query('SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM quiz_groups');
    const position = maxPosRows[0].max_pos + 1;
    const { rows: groupRows } = await pool.query(
      'INSERT INTO quiz_groups(name, position) VALUES ($1, $2) RETURNING id, name, position, created_at',
      [parsed.data.groupTitle, position]
    );
    const group = groupRows[0];

    const generationResults = await Promise.allSettled(parsed.data.items.map(async (item) => {
      const llm = await generateQuizFromLLM(
        `${parsed.data.topic}\n\nQuiz title: ${item.title}\nQuiz focus: ${item.focus}`,
        parsed.data.settings,
        {
          sourceText: parsed.data.sourceText,
          githubRepoUrl: parsed.data.githubRepoUrl,
          documents: sourceParsed.files
        }
      );
      const quizId = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO quizzes(id, title, topic, settings, questions, group_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
        [
          quizId,
          item.title,
          `${parsed.data.topic}\n\n${item.focus}`,
          JSON.stringify(parsed.data.settings),
          JSON.stringify(llm.questions),
          group.id
        ]
      );
      return rows[0];
    }));

    const quizzes = generationResults
      .filter((entry): entry is PromiseFulfilledResult<{
        id: string;
        title: string;
        topic: string;
        settings: QuizSettings;
        questions: QuizQuestion[];
        created_at: string;
        pinned: boolean;
        pinned_at: string | null;
        group_id: string | null;
      }> => entry.status === 'fulfilled')
      .map((entry) => mapQuizRow(entry.value));
    const errors = generationResults
      .flatMap((entry, index) => entry.status === 'rejected'
        ? [{
            itemTitle: parsed.data.items[index].title,
            message: entry.reason instanceof Error ? entry.reason.message : 'unknown error'
          }]
        : []);

    if (quizzes.length === 0) {
      await pool.query('DELETE FROM quiz_groups WHERE id = $1', [group.id]);
      return res.status(422).json({ error: errors[0]?.message ?? 'All group quiz items failed to generate' });
    }

    logger.info('group_quiz_generate.completed', {
      groupId: group.id,
      total: parsed.data.items.length,
      succeeded: quizzes.length,
      failed: errors.length
    });

    return res.status(201).json({
      groupId: group.id,
      quizzes,
      errors
    });
  } catch (error) {
    logger.error('group_quiz_generate.failed', error, {
      topic: summarizeText(sourceParsed.topic)
    });
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Group quiz generation failed' });
  }
}));

app.patch('/api/quizzes/:id', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const parsed = updateQuizSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
  }
  const { title, pinned, groupId } = parsed.data;
  if (typeof title === 'undefined' && typeof pinned === 'undefined' && typeof groupId === 'undefined') {
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
    if (pinned) {
      updates.push(`group_id = NULL`);
    }
  }
  if (typeof groupId !== 'undefined') {
    params.push(groupId);
    updates.push(`group_id = $${params.length}`);
    if (groupId !== null) {
      updates.push(`pinned = false`);
      updates.push(`pinned_at = NULL`);
    }
  }
  params.push(id);
  const { rows } = await pool.query(`
    UPDATE quizzes SET ${updates.join(', ')}
    WHERE id = $${params.length} AND deleted_at IS NULL
    RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id
  `, params);
  if (!rows[0]) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  const q = rows[0];
  logger.info('quiz_updated', {
    quizId: q.id,
    fields: {
      title: typeof title !== 'undefined',
      pinned: typeof pinned !== 'undefined',
      groupId: typeof groupId !== 'undefined'
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
    pinnedAt: q.pinned_at,
    groupId: q.group_id
  });
}));

app.delete('/api/quizzes/:id', asyncRoute(async (req, res) => {
  const { rowCount } = await pool.query(
    'UPDATE quizzes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [req.params.id]
  );
  if (!rowCount) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  logger.info('quiz_deleted', { quizId: req.params.id });
  return res.status(204).send();
}));

app.post('/api/quizzes/:id/regenerate', generateLimiter, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const parsed = regenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
  }
  const { settings: newSettings, prompt, mode } = parsed.data;

  const { rows } = await pool.query(
    'SELECT id, title, topic, settings, questions, group_id FROM quizzes WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (!rows[0]) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  const quiz = rows[0];
  const settings = newSettings ?? (quiz.settings as QuizSettings);
  const existingQuestions = quiz.questions as QuizQuestion[];

  const started = Date.now();
  try {
    const llm = await generateQuizFromLLM(quiz.topic, settings, {}, existingQuestions, prompt);
    
    if (mode === 'overwrite') {
      const { rows: updated } = await pool.query(
        `UPDATE quizzes SET title = $1, settings = $2::jsonb, questions = $3::jsonb
         WHERE id = $4
         RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
        [llm.title, JSON.stringify(settings), JSON.stringify(llm.questions), id]
      );
      const q = updated[0];
      logger.info('quiz_regenerated.overwrite', { quizId: id, questions: llm.questions.length, durationMs: Date.now() - started });
      return res.json({
        id: q.id, title: q.title, topic: q.topic, settings: q.settings,
        questions: q.questions, createdAt: q.created_at, pinned: q.pinned,
        pinnedAt: q.pinned_at, groupId: q.group_id, contextUsed: llm.contextUsed
      });
    } else {
      const newId = randomUUID();
      const { rows: inserted } = await pool.query(
        `INSERT INTO quizzes(id, title, topic, settings, questions, group_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
        [newId, llm.title, quiz.topic, JSON.stringify(settings), JSON.stringify(llm.questions), quiz.group_id]
      );
      const q = inserted[0];
      logger.info('quiz_regenerated.duplicate', { originalId: id, newId: q.id, questions: llm.questions.length, durationMs: Date.now() - started });
      return res.status(201).json({
        id: q.id, title: q.title, topic: q.topic, settings: q.settings,
        questions: q.questions, createdAt: q.created_at, pinned: q.pinned,
        pinnedAt: q.pinned_at, groupId: q.group_id, contextUsed: llm.contextUsed
      });
    }
  } catch (error) {
    logger.error('quiz_regenerate.failed', error, { quizId: id, durationMs: Date.now() - started });
    return res.status(422).json({ error: error instanceof Error ? error.message : 'Regeneration failed' });
  }
}));

app.get('/api/groups', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT id, name, position, created_at
    FROM quiz_groups
    ORDER BY position ASC, created_at ASC
  `);
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    createdAt: r.created_at
  })));
}));

app.post('/api/groups', asyncRoute(async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
  }
  const { rows: maxPos } = await pool.query('SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM quiz_groups');
  const position = maxPos[0].max_pos + 1;
  const { rows } = await pool.query(
    'INSERT INTO quiz_groups(name, position) VALUES ($1, $2) RETURNING id, name, position, created_at',
    [parsed.data.name, position]
  );
  const g = rows[0];
  logger.info('group_created', { groupId: g.id, name: g.name });
  return res.status(201).json({ id: g.id, name: g.name, position: g.position, createdAt: g.created_at });
}));

app.patch('/api/groups/:id', asyncRoute(async (req, res) => {
  const parsed = updateGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
  }
  const { name, position } = parsed.data;
  if (typeof name === 'undefined' && typeof position === 'undefined') {
    return res.status(400).json({ error: 'No updates requested' });
  }
  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof name !== 'undefined') {
    params.push(name);
    updates.push(`name = $${params.length}`);
  }
  if (typeof position !== 'undefined') {
    params.push(position);
    updates.push(`position = $${params.length}`);
  }
  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE quiz_groups SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING id, name, position, created_at`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'Group not found' });
  const g = rows[0];
  logger.info('group_updated', { groupId: g.id, fields: { name: typeof name !== 'undefined', position: typeof position !== 'undefined' } });
  return res.json({ id: g.id, name: g.name, position: g.position, createdAt: g.created_at });
}));

app.delete('/api/groups/:id', asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount: deletedQuizzes } = await client.query(
      'UPDATE quizzes SET deleted_at = NOW() WHERE group_id = $1 AND deleted_at IS NULL',
      [req.params.id]
    );
    const { rowCount } = await client.query('DELETE FROM quiz_groups WHERE id = $1', [req.params.id]);
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Group not found' });
    }
    await client.query('COMMIT');
    logger.info('group_deleted', { groupId: req.params.id, deletedQuizzes });
    return res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/groups/:id/regenerate', generateLimiter, asyncRoute(async (req, res) => {
  const { id: groupId } = req.params;
  const parsed = regenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join('; ') });
  }
  const { settings, prompt, mode } = parsed.data;
  if (!settings) {
    return res.status(400).json({ error: 'settings is required for group regeneration' });
  }

  const group = await pool.query('SELECT id, name FROM quiz_groups WHERE id = $1', [groupId]);
  if (!group.rows[0]) return res.status(404).json({ error: 'Group not found' });

  const { rows: quizzes } = await pool.query(
    'SELECT id, title, topic, questions FROM quizzes WHERE group_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
    [groupId]
  );
  if (quizzes.length === 0) return res.status(400).json({ error: 'Group has no quizzes' });

  const started = Date.now();
  let targetGroupId: string = groupId;

  if (mode === 'duplicate') {
    const { rows: maxPos } = await pool.query('SELECT COALESCE(MAX(position), -1)::int AS max_pos FROM quiz_groups');
    const position = maxPos[0].max_pos + 1;
    const newName = `${group.rows[0].name} Regen`;
    const { rows: newGroup } = await pool.query(
      'INSERT INTO quiz_groups(name, position) VALUES ($1, $2) RETURNING id',
      [newName, position]
    );
    targetGroupId = newGroup[0].id;
    logger.info('group_regenerate.new_group_created', { originalGroupId: groupId, newGroupId: targetGroupId, name: newName });
  }

  const results = await Promise.allSettled(quizzes.map(async (quiz) => {
    const existingQuestions = quiz.questions as QuizQuestion[];
    const llm = await generateQuizFromLLM(quiz.topic, settings, {}, existingQuestions, prompt);

    if (mode === 'overwrite') {
      const { rows } = await pool.query(
        `UPDATE quizzes SET title = $1, settings = $2::jsonb, questions = $3::jsonb WHERE id = $4
         RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
        [llm.title, JSON.stringify(settings), JSON.stringify(llm.questions), quiz.id]
      );
      return rows[0];
    } else {
      const newId = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO quizzes(id, title, topic, settings, questions, group_id)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)
         RETURNING id, title, topic, settings, questions, created_at, pinned, pinned_at, group_id`,
        [newId, llm.title, quiz.topic, JSON.stringify(settings), JSON.stringify(llm.questions), targetGroupId]
      );
      return rows[0];
    }
  }));

  const succeeded: Array<{ value: { id: string; title: string; topic: string; settings: QuizSettings; questions: QuizQuestion[]; created_at: string; pinned: boolean; pinned_at: string | null; group_id: string | null } }> = [];
  const failed: Array<{ reason: unknown }> = [];
  for (const r of results) {
    if (r.status === 'fulfilled') succeeded.push(r);
    else failed.push(r);
  }

  logger.info('group_regenerate.completed', {
    groupId,
    mode,
    targetGroupId,
    total: quizzes.length,
    succeeded: succeeded.length,
    failed: failed.length,
    durationMs: Date.now() - started
  });

  if (failed.length > 0 && succeeded.length === 0) {
    return res.status(422).json({ error: `All ${quizzes.length} quizzes failed to regenerate. First error: ${failed[0].reason instanceof Error ? failed[0].reason.message : 'unknown'}` });
  }

  const regeneratedQuizzes = succeeded.map((r) => {
    const q = r.value;
    return {
      id: q.id, title: q.title, topic: q.topic, settings: q.settings,
      questions: q.questions, createdAt: q.created_at, pinned: q.pinned,
      pinnedAt: q.pinned_at, groupId: q.group_id
    };
  });

  return res.json({
    groupId: targetGroupId,
    quizzes: regeneratedQuizzes,
    errors: failed.map((f) => f.reason instanceof Error ? f.reason.message : 'unknown error')
  });
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

  let normalizedAnswers: AttemptAnswer[];
  try {
    normalizedAnswers = normalizeAttemptAnswers(questions, answers);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid answers payload' });
  }

  const total = questions.length;
  const { score } = scoreAttempt(questions, normalizedAnswers, config.MULTI_SELECT_PENALTY_ALPHA);
  const submittedAt = new Date();
  logger.info('attempt_submitted', {
    quizId,
    score,
    total,
    answered: normalizedAnswers.filter((answer) => answer.selectedAnswers.length > 0).length,
    startedAt,
    completedAt,
    submittedAt: submittedAt.toISOString()
  });
  const id = randomUUID();
  const { rows } = await pool.query(`
    INSERT INTO attempts(id, quiz_id, answers, score, total, started_at, completed_at, submitted_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)
    RETURNING id, quiz_id, answers, score, total, started_at, completed_at, submitted_at
  `, [id, quizId, JSON.stringify(normalizedAnswers), score, total, startedAt, completedAt, submittedAt]);
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
           q.title, q.topic, q.settings, q.questions, q.pinned, q.deleted_at
    FROM attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    WHERE a.id = $1
  `, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Attempt not found' });
  const r = rows[0];
  const questions = r.questions as QuizQuestion[];
  const normalizedAnswers = normalizeAttemptAnswers(questions, r.answers as AttemptAnswer[]);
  const { questionScores } = scoreAttempt(questions, normalizedAnswers, config.MULTI_SELECT_PENALTY_ALPHA);
  return res.json({
    id: r.id,
    quizId: r.quiz_id,
    answers: normalizedAnswers.map((answer) => answer.selectedAnswers),
    score: r.score,
    total: r.total,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    questionScores,
    timeTakenSeconds: Math.max(0, Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000)),
    quiz: {
      id: r.quiz_id,
      title: r.title,
      topic: r.topic,
      settings: r.settings,
      questions,
      pinned: r.pinned,
      deletedAt: r.deleted_at,
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
    SELECT a.id, a.quiz_id, a.score, a.total, a.started_at, a.completed_at, a.guest_name, q.title, q.deleted_at
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
    quizDeleted: r.deleted_at !== null,
    timeTakenSeconds: Math.max(0, Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000))
  })));
}));

app.get('/api/results/metrics', asyncRoute(async (_req, res) => {
  const [quizzes, attempts] = await Promise.all([
    pool.query('SELECT id, title FROM quizzes'),
    pool.query('SELECT quiz_id, score, total, completed_at FROM attempts ORDER BY completed_at ASC')
  ]);

  const activeQuizzes = quizzes.rows.filter((q) => true);
  const totalQuizzes = activeQuizzes.length;
  const totalAttempts = attempts.rowCount ?? 0;
  const percentages = attempts.rows.map((a) => (a.total ? (a.score / a.total) * 100 : 0));
  const averageScore = percentages.length ? percentages.reduce((sum, p) => sum + p, 0) / percentages.length : 0;

  const bestByQuiz = new Map<string, number>();
  const countByQuiz = new Map<string, number>();
  for (const row of attempts.rows) {
    const pct = row.total ? (row.score / row.total) * 100 : 0;
    bestByQuiz.set(row.quiz_id, Math.max(bestByQuiz.get(row.quiz_id) ?? Number.NEGATIVE_INFINITY, pct));
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
  answers: z.array(attemptAnswerSchema),
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
           q.title AS quiz_title, q.deleted_at AS quiz_deleted_at,
           COUNT(a.id)::int AS attempt_count
    FROM quiz_shares s
    JOIN quizzes q ON q.id = s.quiz_id
    LEFT JOIN attempts a ON a.share_id = s.id
    GROUP BY s.id, q.title, q.deleted_at
    ORDER BY s.created_at DESC
  `);
  return res.json(rows.map((s) => ({
    id: s.id, quizId: s.quiz_id, quizTitle: s.quiz_title, token: s.token,
    guestName: s.guest_name, maxAttempts: s.max_attempts,
    expiresAt: s.expires_at, createdAt: s.created_at, attemptCount: s.attempt_count,
    quizDeleted: s.quiz_deleted_at !== null
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
  const publicQuestions = (s.questions as QuizQuestion[]).map(({ id, question, responseType, choices }) => ({
    id,
    question,
    responseType,
    choices
  }));

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
    let normalizedAnswers: AttemptAnswer[];
    try {
      normalizedAnswers = normalizeAttemptAnswers(questions, answers);
    } catch (error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid answers payload' });
    }

    const total = questions.length;
    const { score, questionScores } = scoreAttempt(questions, normalizedAnswers, config.MULTI_SELECT_PENALTY_ALPHA);
    const submittedAt = new Date();

    const id = randomUUID();
    const { rows } = await client.query(`
      INSERT INTO attempts(id, quiz_id, answers, score, total, started_at, completed_at, submitted_at, guest_name, share_id)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, quiz_id, score, total, started_at, completed_at, submitted_at
    `, [id, share.quiz_id, JSON.stringify(normalizedAnswers), score, total, startedAt, completedAt, submittedAt, share.guest_name, share.id]);

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
        id: q.id,
        question: q.question,
        responseType: q.responseType,
        choices: q.choices,
        correctAnswers: q.correctAnswers,
        explanation: q.explanation,
        userAnswers: normalizedAnswers[i].selectedAnswers,
        questionScore: questionScores[i]
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
  app.use(express.static(publicDir, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/config.js' || /\.[a-z0-9]+$/i.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-store');
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
