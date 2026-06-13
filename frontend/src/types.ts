// ─── Types ────────────────────────────────────────────────────────────────────

export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'multi_select', 'free_text'] as const;
export type QuestionType = typeof QUESTION_TYPES[number];

export type QuizSettings = {
  numQuestions: number;
  choicesPerQuestion: number;
  difficulty: number;
  language: string;
  questionType: QuestionType[];
};

export type QuizQuestion = {
  id: string;
  question: string;
  responseType: 'single_choice' | 'multi_select' | 'free_text';
  choices: string[];
  correctAnswers: number[];
  explanation?: string;
};

export type Quiz = {
  id: string;
  title: string;
  topic: string;
  settings: QuizSettings;
  questions: QuizQuestion[];
  createdAt: string;
  pinned: boolean;
  pinnedAt: string | null;
  groupId: string | null;
  contextUsed?: boolean;
};

export type QuizGroup = {
  id: string;
  name: string;
  position: number;
  createdAt: string;
};

export type GroupQuizProposalItem = {
  title: string;
  focus: string;
};

export type GroupQuizProposal = {
  groupTitle: string;
  items: GroupQuizProposalItem[];
};

export type GroupQuizGenerationError = {
  itemTitle: string;
  message: string;
};

export type GroupQuizGenerationResult = {
  groupId: string;
  quizzes: Quiz[];
  errors: GroupQuizGenerationError[];
};

export type GenerationJobKind =
  | 'quiz_generate'
  | 'group_propose'
  | 'group_generate'
  | 'quiz_regenerate'
  | 'group_regenerate';

export type GenerationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type GenerationJob<T = unknown> = {
  id: string;
  kind: GenerationJobKind;
  status: GenerationJobStatus;
  currentStep: string;
  stepIndex: number;
  stepTotal: number;
  doneCount: number | null;
  totalCount: number | null;
  message: string | null;
  resultPayload: T | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobCreatedResponse = {
  jobId: string;
};

export type AttemptHistory = {
  id: string;
  quizId: string;
  quizTitle: string;
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  timeTakenSeconds: number;
  guestName: string | null;
  quizDeleted: boolean;
};

export type QuizShare = {
  id: string;
  quizId: string;
  quizTitle?: string;
  token: string;
  guestName: string;
  maxAttempts: number | null;
  expiresAt: string | null;
  createdAt: string;
  attemptCount: number;
  quizDeleted: boolean;
};

// Public (guest) quiz types — questions without correctIndex/explanation
export type PublicQuestion = {
  id: string;
  question: string;
  responseType: 'single_choice' | 'multi_select' | 'free_text';
  choices: string[];
};

export type GuestQuizData = {
  shareId: string;
  quizId: string;
  title: string;
  guestName: string;
  maxAttempts: number | null;
  attemptCount: number;
  questions: PublicQuestion[];
};

export type GuestAttemptResult = {
  id: string;
  quizId: string;
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  evaluations: FreeTextEvaluation[] | null;
  questions: Array<{
    id: string;
    question: string;
    responseType: 'single_choice' | 'multi_select' | 'free_text';
    choices: string[];
    correctAnswers: number[];
    explanation?: string;
    userAnswers: number[];
    freeTextAnswer: string | null;
    questionScore: number;
  }>;
};

export type Metrics = {
  totalQuizzes: number;
  totalAttempts: number;
  averageScore: number;
  bestScorePerQuiz: Array<{ quizId: string; quizTitle: string; bestScore: number }>;
  mostAttemptedQuiz: { quizId: string; quizTitle: string; attempts: number } | null;
  trendByQuiz: Record<string, { quizTitle: string; points: Array<{ completedAt: string; scorePercent: number }> }>;
};

export type FreeTextEvaluation = {
  questionId: string;
  score: number;
  explanation: string;
  optimalAnswer: string;
};

export type AttemptReview = {
  id: string;
  quizId: string;
  answers: number[][];
  freeTextAnswers: (string | null)[];
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  questionScores: number[];
  evaluations: FreeTextEvaluation[] | null;
  timeTakenSeconds: number;
  quiz: Quiz;
};

export type SettingsDisplay = {
  LLM_API_STYLE: string;
  LLM_BASE_URL: string;
  LLM_API_KEY_MASKED: string;
  LLM_MODEL: string;
  LLM_MAX_TOKENS: number;
  LLM_TEMPERATURE: number;
  EMBEDDING_API_STYLE: string;
  EMBEDDING_BASE_URL: string;
  EMBEDDING_API_KEY_MASKED: string;
  EMBEDDING_MODEL: string;
  MAX_EMBEDDING_CANDIDATES: number;
  EMBEDDING_BATCH_SIZE: number;
  MAX_RETRIEVED_CHUNKS: number;
  MAX_RETRIEVED_CHARS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  GENERATE_RATE_LIMIT_MAX_REQUESTS: number;
  ENCRYPTION_CONFIGURED: boolean;
};

// ─── Auth ──────────────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'admin' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  authProvider: 'oidc' | 'email';
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthStatus {
  hasUsers: boolean;
  oidcEnabled: boolean;
  emailEnabled: boolean;
}

export interface Model {
  id: string;
  label: string;
  modelType: 'llm' | 'embedding';
  provider: string;
  modelId: string;
  apiKeyMasked: string;
  baseUrl: string | null;
  providerId: string | null;
  maxTokens: number | null;
  temperature: number | null;
  maxRetrievedChunks: number | null;
  maxRetrievedChars: number | null;
  maxEmbeddingCandidates: number | null;
  embeddingBatchSize: number | null;
  createdBy: string;
  isSystem: boolean;
  isDefault: boolean;
  assignedTo: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface Provider {
  id: string;
  label: string;
  provider: string;
  baseUrl: string | null;
  apiKeyMasked: string;
  createdBy: string;
  isSystem: boolean;
  assignedTo: string[] | null;
  createdAt: string;
  updatedAt: string;
}
