import { createContext, useContext, useState, useEffect } from 'react';
import { req } from './api';
import type { Quiz, QuizGroup } from './types';

// ─── Shared Context ───────────────────────────────────────────────────────────

type QuizzesCtx = {
  quizzes: Quiz[];
  groups: QuizGroup[];
  reload: () => Promise<void>;
  reloadGroups: () => Promise<void>;
};

export const QuizzesContext = createContext<QuizzesCtx>({ quizzes: [], groups: [], reload: async () => {}, reloadGroups: async () => {} });
export const useQuizzes = () => useContext(QuizzesContext);

export function AdminApp({ children }: { children: React.ReactNode }) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [groups, setGroups] = useState<QuizGroup[]>([]);

  async function reload() {
    const data = await req<Quiz[]>('/api/quizzes');
    setQuizzes(data);
  }

  async function reloadGroups() {
    const data = await req<QuizGroup[]>('/api/groups');
    setGroups(data);
  }

  useEffect(() => { void reload(); void reloadGroups(); }, []);

  return (
    <QuizzesContext.Provider value={{ quizzes, groups, reload, reloadGroups }}>
      {children}
    </QuizzesContext.Provider>
  );
}
