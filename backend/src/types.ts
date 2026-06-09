export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type QuestionType = 'multiple_choice' | 'true_false' | 'mixed' | 'multi_select';
export type ResponseType = 'single_choice' | 'multi_select';

export interface QuizSettings {
  numQuestions: number;
  choicesPerQuestion: number;
  difficulty: Difficulty;
  language: string;
  questionType: QuestionType;
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
