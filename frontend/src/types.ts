// ─── Types ────────────────────────────────────────────────────────────────────

export type QuizSettings = {
  numQuestions: number;
  choicesPerQuestion: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  language: string;
  questionType: 'multiple_choice' | 'true_false' | 'mixed';
};

export type QuizQuestion = {
  question: string;
  choices: string[];
  correctIndex: number;
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
  question: string;
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
  questions: Array<{
    question: string;
    choices: string[];
    correctIndex: number;
    explanation?: string;
    userAnswer: number;
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

export type AttemptReview = {
  id: string;
  quizId: string;
  answers: number[];
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
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
