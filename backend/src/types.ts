export type Difficulty = number;
export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'multi_select', 'free_text'] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export type ResponseType = 'single_choice' | 'multi_select' | 'free_text';

export interface QuizSettings {
  numQuestions: number;
  choicesPerQuestion: number;
  difficulty: Difficulty;
  language: string;
  questionType: QuestionType[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  choices: string[];
  responseType: ResponseType;
  correctAnswers: number[];
  explanation?: string;
}

export interface AttemptAnswer {
  questionId: string;
  selectedAnswers: number[];
  freeText?: string;
}

export interface FreeTextEvaluation {
  questionId: string;
  score: number;
  explanation: string;
  optimalAnswer: string;
}

export interface Quiz {
  id: string;
  title: string;
  topic: string;
  settings: QuizSettings;
  questions: QuizQuestion[];
  createdAt: string;
  pinned: boolean;
  pinnedAt: string | null;
}

export interface Attempt {
  id: string;
  quizId: string;
  answers: AttemptAnswer[];
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  guestName?: string | null;
  shareId?: string | null;
}

export interface QuizShare {
  id: string;
  quizId: string;
  quizTitle?: string;
  token: string;
  guestName: string;
  maxAttempts: number | null;
  expiresAt: string | null;
  createdAt: string;
  attemptCount: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type AuthProvider = 'oidc' | 'email';

export const OIDC_GROUPS = ['quiz_super_admin', 'quiz_admin', 'quiz_user'] as const;
export type OIDCGroup = typeof OIDC_GROUPS[number];

export interface User {
  id: string;
  sub: string | null;
  email: string;
  name: string | null;
  passwordHash: string | null;
  role: 'super_admin' | 'admin' | 'user';
  authProvider: AuthProvider;
  createdAt: string;
  updatedAt: string;
}

export type ModelType = 'llm' | 'embedding';

export interface Model {
  id: string;
  label: string;
  modelType: ModelType;
  provider: string;
  modelId: string;
  apiKeyEncrypted: string;
  apiKeyMasked: string;
  baseUrl: string | null;
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

export interface ModelInput {
  label: string;
  modelType?: ModelType;
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetrievedChunks?: number;
  maxRetrievedChars?: number;
  maxEmbeddingCandidates?: number;
  embeddingBatchSize?: number;
  isSystem?: boolean;
}

export interface ModelUpdateInput {
  label?: string;
  provider?: string;
  modelId?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetrievedChunks?: number;
  maxRetrievedChars?: number;
  maxEmbeddingCandidates?: number;
  embeddingBatchSize?: number;
}

export interface UserPatch {
  role?: 'admin' | 'user';
}

export interface ModelAccessInput {
  userId: string;
}

// LLM config passed to generation functions
export interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
}

export interface EmbeddingConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  maxCandidates?: number;
  maxRetrievedChunks?: number;
  maxRetrievedChars?: number;
  batchSize?: number;
}
