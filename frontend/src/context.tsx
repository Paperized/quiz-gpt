import { createContext, useContext, useState, useEffect } from 'react';
import { req } from './api';
import type { Quiz } from './types';

// ─── Shared Context ───────────────────────────────────────────────────────────

type QuizzesCtx = {
  quizzes: Quiz[];
  reload: () => Promise<void>;
};

export const QuizzesContext = createContext<QuizzesCtx>({ quizzes: [], reload: async () => {} });
export const useQuizzes = () => useContext(QuizzesContext);

export function AdminApp({ children }: { children: React.ReactNode }) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);

  async function reload() {
    const data = await req<Quiz[]>('/api/quizzes');
    setQuizzes(data);
  }

  useEffect(() => { void reload(); }, []);

  return (
    <QuizzesContext.Provider value={{ quizzes, reload }}>
      {children}
    </QuizzesContext.Provider>
  );
}
