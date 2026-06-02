import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { req } from '../api';
import { scoreColor, formatSeconds } from '../helpers';
import type { AttemptReview } from '../types';

// ─── Review Page (/review/:attemptId) ────────────────────────────────────────

export function ReviewPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<AttemptReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    req<AttemptReview>(`/api/attempts/${attemptId}`)
      .then(setAttempt)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load attempt'))
      .finally(() => setLoading(false));
  }, [attemptId]);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: '#141313' }}>
      <span className="text-text-muted text-[14px]">Loading...</span>
    </div>
  );

  if (error || !attempt) return (
    <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: '#141313' }}>
      <div className="text-center">
        <p className="text-error text-[14px] mb-4">{error ?? 'Attempt not found'}</p>
        <button onClick={() => navigate('/results')} className="text-[12px] text-text-muted hover:text-on-surface">← Back to Results</button>
      </div>
    </div>
  );

  const { quiz, answers } = attempt;
  const score = quiz.questions.reduce((acc, q, i) => acc + ((answers[i] ?? -1) === q.correctIndex ? 1 : 0), 0);
  const pct = Math.round((score / quiz.questions.length) * 100);
  const completedDate = new Date(attempt.completedAt).toLocaleString();

  return (
    <>
      {/* Topbar */}
      <header className="flex justify-between items-center h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[14px] font-semibold text-on-surface font-geist truncate">{quiz.title}</span>
          <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider shrink-0">Read-only</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] text-text-muted hidden md:block">{completedDate}</span>
          <span className={`px-4 py-1.5 rounded text-[12px] font-bold ${scoreColor(pct)}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {score}/{quiz.questions.length} · {pct}%
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto px-6 py-8 pb-8">
          {/* Quiz header */}
          <div className="mb-8 border-b border-border-subtle pb-6">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{quiz.settings.difficulty}</span>
              <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{quiz.settings.questionType.replace('_', ' ')}</span>
              <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{formatSeconds(attempt.timeTakenSeconds)}</span>
            </div>
            <h2 className="text-[32px] font-bold text-on-surface font-geist tracking-tight">{quiz.title}</h2>
            <p className="text-[16px] text-text-muted mt-2 max-w-2xl">{quiz.topic}</p>
          </div>

          {/* Questions — all, read-only */}
          <div className="flex flex-col gap-4">
            {quiz.questions.map((q, idx) => {
              const selected = answers[idx] ?? -1;
              const isCorrect = (cIdx: number) => cIdx === q.correctIndex;
              const isWrong = (cIdx: number) => selected === cIdx && cIdx !== q.correctIndex;
              const skipped = selected === -1;

              return (
                <div key={idx} className="rounded-lg p-6 border border-border-subtle" style={{ backgroundColor: '#1c1b1b' }}>
                  <div className="flex items-start gap-3 mb-4">
                    <span className="font-mono text-sm text-text-muted mt-0.5 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                    <h3 className="text-[18px] font-medium text-on-surface font-geist leading-snug">{q.question}</h3>
                    {skipped && <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px]">Skipped</span>}
                  </div>

                  <div className="flex flex-col gap-3 ml-8">
                    {q.choices.map((choice, cIdx) => {
                      let cls = 'flex items-center gap-4 p-4 rounded border transition-colors';
                      if (isCorrect(cIdx)) cls += ' quiz-option-correct';
                      else if (isWrong(cIdx)) cls += ' quiz-option-wrong';
                      else cls += ' border-border-subtle opacity-50';

                      return (
                        <div key={cIdx} className={cls}>
                          <div className={`w-4 h-4 rounded-full border relative shrink-0 ${isCorrect(cIdx) ? 'border-secondary' : 'border-outline'}`}>
                            {(selected === cIdx || isCorrect(cIdx)) && (
                              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-secondary block" />
                            )}
                          </div>
                          <span className={`text-[14px] flex-1 ${isCorrect(cIdx) ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>{choice}</span>
                          {isCorrect(cIdx) && <Icon name="check_circle" size={18} className="text-success shrink-0" fill />}
                          {isWrong(cIdx) && <Icon name="cancel" size={18} className="text-error shrink-0" fill />}
                        </div>
                      );
                    })}
                  </div>

                  {q.explanation && (
                    <div className="mt-4 ml-8 p-3 bg-surface-container rounded border border-border-subtle">
                      <p className="text-[13px] text-text-muted"><span className="text-secondary font-medium mr-1">Explanation:</span>{q.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="mt-8 pt-6 border-t border-border-subtle flex justify-between items-center">
            <span className="text-[12px] text-text-muted">{quiz.questions.filter((_, i) => answers[i] !== undefined && answers[i] !== -1).length} of {quiz.questions.length} answered</span>
            <span className={`text-[14px] font-bold ${scoreColor(pct)}`}>Final Score: {pct}%</span>
          </div>
        </div>
      </main>
    </>
  );
}
