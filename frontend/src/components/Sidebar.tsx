import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from './Icon';
import { useQuizzes } from '../context';
import { req } from '../api';
import type { Quiz } from '../types';

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { quizzes, reload } = useQuizzes();
  const navigate = useNavigate();
  const location = useLocation();

  const pinnedQuizzes = useMemo(() => quizzes.filter((q) => q.pinned), [quizzes]);
  const recentQuizzes = useMemo(
    () => [...quizzes].filter((q) => !q.pinned).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
    [quizzes]
  );

  const isResults = location.pathname === '/results';
  const isShares = location.pathname === '/shares';
  const activeQuizId = location.pathname.startsWith('/quiz/') ? location.pathname.split('/')[2] : null;

  async function togglePin(quiz: Quiz, e: React.MouseEvent) {
    e.stopPropagation();
    await req<Quiz>(`/api/quizzes/${quiz.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !quiz.pinned }),
    });
    await reload();
  }

  async function deleteQuiz(quiz: Quiz, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${quiz.title}"?`)) return;
    await req<void>(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
    if (activeQuizId === quiz.id) navigate('/');
    await reload();
  }

  function goQuiz(id: string) {
    navigate(`/quiz/${id}`);
    onClose();
  }

  return (
    <nav
      className={`w-[280px] h-screen fixed left-0 top-0 border-r border-border-subtle bg-surface-sidebar flex flex-col z-50 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
    >
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-6 flex items-center gap-3 border-b border-border-subtle/50">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded bg-primary-container flex items-center justify-center">
              <Icon name="lightbulb" fill size={18} className="text-secondary" />
            </div>
            <h1 className="text-[18px] font-bold text-on-surface font-geist tracking-tight">QuizGPT</h1>
          </button>
        </div>

        {/* New Quiz */}
        <div className="px-4 py-4">
          <button
            onClick={() => { navigate('/'); onClose(); }}
            className="w-full flex items-center justify-center gap-2 bg-accent-teal hover:opacity-90 text-white text-[12px] font-bold py-3 rounded-lg transition-all shadow-sm"
          >
            <Icon name="add" size={18} />
            New Quiz
          </button>
        </div>

        {/* Navigation */}
        <div className="px-4 pb-2">
          <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] mb-1 px-1">Navigation</h3>
          <ul className="flex flex-col gap-0.5">
            <li>
              <button
                onClick={() => { navigate('/results'); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors duration-200 ${isResults ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
              >
                <Icon name="bar_chart" size={18} className={isResults ? 'text-secondary' : ''} />
                <span className="text-[12px] font-medium">Results & Metrics</span>
              </button>
            </li>
            <li>
              <button
                onClick={() => { navigate('/shares'); onClose(); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors duration-200 ${isShares ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
              >
                <Icon name="link" size={18} className={isShares ? 'text-secondary' : ''} />
                <span className="text-[12px] font-medium">Shares</span>
              </button>
            </li>
          </ul>
        </div>

        {/* Pinned */}
        {pinnedQuizzes.length > 0 && (
          <div className="mt-6 px-4">
            <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] mb-2 px-1">Pinned</h3>
            <ul className="flex flex-col gap-1">
              {pinnedQuizzes.map((quiz) => (
                <li key={quiz.id}>
                  <button
                    onClick={() => goQuiz(quiz.id)}
                    className={`w-full flex items-center justify-between px-4 py-2 rounded text-left transition-colors duration-200 group ${activeQuizId === quiz.id ? 'bg-surface-container-highest text-on-surface' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name="push_pin" size={16} className="text-secondary shrink-0" />
                      <span className="text-[12px] truncate">{quiz.title}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={(e) => void togglePin(quiz, e)} className="text-text-muted hover:text-secondary p-0.5">
                        <Icon name="push_pin" size={14} fill />
                      </button>
                      <button onClick={(e) => void deleteQuiz(quiz, e)} className="text-text-muted hover:text-error p-0.5">
                        <Icon name="delete" size={14} />
                      </button>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recent */}
        <div className="mt-6 px-4 flex-1">
          <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] mb-2 px-1">Recent</h3>
          <ul className="flex flex-col gap-1">
            {recentQuizzes.map((quiz) => (
              <li key={quiz.id}>
                <button
                  onClick={() => goQuiz(quiz.id)}
                  className={`w-full flex items-center justify-between px-4 py-2 rounded text-left transition-colors duration-200 group ${activeQuizId === quiz.id ? 'bg-surface-container-highest text-on-surface' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon name="history" size={16} className="shrink-0" />
                    <span className="text-[12px] truncate">{quiz.title}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={(e) => void togglePin(quiz, e)} className="text-text-muted hover:text-secondary p-0.5">
                      <Icon name="push_pin" size={14} />
                    </button>
                    <button onClick={(e) => void deleteQuiz(quiz, e)} className="text-text-muted hover:text-error p-0.5">
                      <Icon name="delete" size={14} />
                    </button>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t border-border-subtle px-2 py-4 space-y-1">
          <button
            onClick={() => { navigate('/settings'); onClose(); }}
            className={`w-full flex items-center gap-3 px-4 py-2 rounded transition-colors ${location.pathname === '/settings' ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
          >
            <Icon name="settings" size={18} className={location.pathname === '/settings' ? 'text-secondary' : ''} />
            <span className="text-[12px]">Settings</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
