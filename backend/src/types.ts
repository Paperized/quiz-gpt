export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type QuestionType = 'multiple_choice' | 'true_false' | 'mixed';

export interface QuizSettings {
  numQuestions: number;
  choicesPerQuestion: number;
  difficulty: Difficulty;
  language: string;
  questionType: QuestionType;
}

export interface QuizQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
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
  answers: number[];
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
