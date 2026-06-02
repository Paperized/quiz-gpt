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
}
