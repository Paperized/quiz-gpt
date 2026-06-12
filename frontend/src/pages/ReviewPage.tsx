import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { req } from '../api';
import { scoreColor, formatScore, formatSeconds } from '../helpers';
import { formatDifficultyLabel } from '../difficulty';
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

  const { quiz, answers, freeTextAnswers } = attempt;
  const pct = Math.round((attempt.score / attempt.total) * 100);
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
            {formatScore(attempt.score)}/{attempt.total} · {pct}%
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto px-6 py-8 pb-8">
          {/* Quiz header */}
          <div className="mb-8 border-b border-border-subtle pb-6">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{formatDifficultyLabel(quiz.settings.difficulty)}</span>
              <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{quiz.settings.questionType.map(t => t.replace('_', ' ')).join(', ')}</span>
              <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{formatSeconds(attempt.timeTakenSeconds)}</span>
            </div>
            <h2 className="text-[32px] font-bold text-on-surface font-geist tracking-tight">{quiz.title}</h2>
            <p className="text-[16px] text-text-muted mt-2 max-w-2xl">{quiz.topic}</p>
          </div>

          {/* Questions — all, read-only */}
          <div className="flex flex-col gap-4">
            {quiz.questions.map((q, idx) => {
              const selected = answers[idx] ?? [];
              const correctSet = new Set(q.correctAnswers);
              const selectedSet = new Set(selected);
              const skipped = selected.length === 0;
              const boxShape = q.responseType === 'multi_select' ? 'rounded-sm' : 'rounded-full';

              return (
                <div key={idx} className="rounded-lg p-6 border border-border-subtle" style={{ backgroundColor: '#1c1b1b' }}>
                  <div className="flex items-start gap-3 mb-4">
                    <span className="font-mono text-sm text-text-muted mt-0.5 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                    <div className="flex-1">
                      <h3 className="text-[18px] font-medium text-on-surface font-geist leading-snug">{q.question}</h3>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">
                          {q.responseType === 'multi_select' ? 'Multi Select' : q.responseType === 'free_text' ? 'Free Text' : 'Single Choice'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">
                          {formatScore(attempt.questionScores[idx] ?? 0)} point
                        </span>
                      </div>
                    </div>
                    {skipped && !q.responseType && <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px]">Skipped</span>}
                  </div>

                  {q.responseType === 'free_text' ? (
                    <div className="flex flex-col gap-3 ml-8">
                      <div className="p-4 bg-[#0D0D0D] border border-border-subtle rounded">
                        <p className="text-[11px] text-text-muted mb-1 uppercase tracking-wider">Your answer</p>
                        <p className="text-[14px] text-on-surface whitespace-pre-wrap">{freeTextAnswers?.[idx] ?? '(no answer)'}</p>
                      </div>
                      {(() => {
                        const evaluation = attempt.evaluations?.find((e) => e.questionId === q.id);
                        if (!evaluation) return null;
                        return (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] text-text-muted">Score:</span>
                              <span className={`text-[14px] font-semibold ${evaluation.score >= 0.7 ? 'text-success' : evaluation.score >= 0.4 ? 'text-yellow-400' : 'text-error'}`}>
                                {evaluation.score.toFixed(2)} / 1
                              </span>
                            </div>
                            <div className="p-3 bg-surface-container rounded border border-border-subtle">
                              <p className="text-[11px] text-text-muted mb-1 uppercase tracking-wider">Evaluation</p>
                              <p className="text-[13px] text-on-surface whitespace-pre-wrap">{evaluation.explanation}</p>
                            </div>
                            <div className="p-3 bg-success/5 rounded border border-success/20">
                              <p className="text-[11px] text-success mb-1 uppercase tracking-wider">Optimal answer</p>
                              <p className="text-[13px] text-on-surface whitespace-pre-wrap">{evaluation.optimalAnswer}</p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 ml-8">
                      {q.choices.map((choice, cIdx) => {
                      let cls = 'flex items-center gap-4 p-4 rounded border transition-colors';
                      if (correctSet.has(cIdx)) cls += ' quiz-option-correct';
                      else if (selectedSet.has(cIdx)) cls += ' quiz-option-wrong';
                      else cls += ' border-border-subtle opacity-50';

                      return (
                        <div key={cIdx} className={cls}>
                          <div className={`w-4 h-4 border relative shrink-0 ${boxShape} ${correctSet.has(cIdx) || selectedSet.has(cIdx) ? 'border-secondary' : 'border-outline'}`}>
                            {(selectedSet.has(cIdx) || correctSet.has(cIdx)) && (
                              <span className={`absolute inset-0.5 bg-secondary block ${boxShape}`} />
                            )}
                          </div>
                          <span className={`text-[14px] flex-1 ${correctSet.has(cIdx) ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>{choice}</span>
                          {correctSet.has(cIdx) && <Icon name="check_circle" size={18} className="text-success shrink-0" fill />}
                          {selectedSet.has(cIdx) && !correctSet.has(cIdx) && <Icon name="cancel" size={18} className="text-error shrink-0" fill />}
                        </div>
                      );
                    })}
                  </div>
                  )}

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
            <span className="text-[12px] text-text-muted">{
              answers.filter((selected) => selected.length > 0).length +
              (freeTextAnswers?.filter((t) => t && t.trim().length > 0).length ?? 0)
            } of {quiz.questions.length} answered</span>
            <span className={`text-[14px] font-bold ${scoreColor(pct)}`}>Final Score: {pct}%</span>
          </div>
        </div>
      </main>
    </>
  );
}
