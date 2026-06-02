import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ShareDialog } from '../components/ShareDialog';
import { useQuizzes } from '../context';
import { req } from '../api';
import { shuffleArray } from '../helpers';
import type { Quiz } from '../types';

// ─── Quiz Page (/quiz/:id) ────────────────────────────────────────────────────

export function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const { quizzes, reload } = useQuizzes();
  const navigate = useNavigate();

  const [localQuizzes, setLocalQuizzes] = useState(quizzes);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [startedAt] = useState(() => new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'one'>(() => (localStorage.getItem('viewMode') as 'all' | 'one') ?? 'all');
  const [singleIndex, setSingleIndex] = useState(0);
  const [showShare, setShowShare] = useState(false);

  useEffect(() => { setLocalQuizzes(quizzes); }, [quizzes]);
  useEffect(() => { localStorage.setItem('viewMode', viewMode); }, [viewMode]);
  useEffect(() => { setAnswers({}); setSubmitted(false); setError(null); setSingleIndex(0); }, [id]);

  const quiz = useMemo(() => localQuizzes.find((q) => q.id === id) ?? null, [localQuizzes, id]);

  if (!quiz) {
    return localQuizzes.length > 0
      ? <Navigate to="/" replace />
      : (
        <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: '#141313' }}>
          <span className="text-text-muted text-[14px]">Loading...</span>
        </div>
      );
  }

  const questionsToRender = viewMode === 'all' ? quiz.questions : [quiz.questions[singleIndex]];
  const totalQuestions = quiz.questions.length;
  const answeredCount = Object.keys(answers).length;
  const finalScore = quiz.questions.reduce((acc, q, i) => acc + ((answers[i] ?? -1) === q.correctIndex ? 1 : 0), 0);

  function shuffle() {
    const shuffled = shuffleArray(quiz!.questions).map((q) => {
      const pairs = q.choices.map((c, i) => ({ c, i }));
      const sc = shuffleArray(pairs);
      return { ...q, choices: sc.map((x) => x.c), correctIndex: sc.findIndex((x) => x.i === q.correctIndex) };
    });
    setLocalQuizzes((prev) => prev.map((q) => q.id === quiz!.id ? { ...q, questions: shuffled } : q));
    setAnswers({}); setSubmitted(false);
  }

  async function togglePin(e: React.MouseEvent) {
    e.stopPropagation();
    await req<Quiz>(`/api/quizzes/${quiz!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !quiz!.pinned }) });
    await reload();
  }

  async function submit() {
    try {
      await req('/api/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: quiz!.id, answers: quiz!.questions.map((_, i) => answers[i] ?? -1), startedAt, completedAt: new Date().toISOString() }),
      });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    }
  }

  function retake() { setAnswers({}); setSubmitted(false); setSingleIndex(0); }

  return (
    <>
      {showShare && <ShareDialog quizId={quiz.id} onClose={() => setShowShare(false)} />}
      {/* Topbar */}
      <header className="relative flex justify-between items-center h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <span className="text-[14px] font-semibold text-on-surface font-geist truncate">{quiz.title}</span>
        {/* Progress bar — centered absolutely so it doesn't affect left/right layout */}
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
          <div className="w-48 h-1 bg-surface-variant rounded-full overflow-hidden">
            <div className="h-full bg-secondary rounded-full transition-all duration-300" style={{ width: `${totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0}%` }} />
          </div>
          <span className="text-[11px] text-text-muted">{answeredCount}/{totalQuestions}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={shuffle} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-secondary hover:bg-surface-variant transition-colors" title="Shuffle">
            <Icon name="shuffle" size={20} />
          </button>
          <button onClick={(e) => void togglePin(e)} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-secondary hover:bg-surface-variant transition-colors">
            <Icon name="push_pin" size={20} fill={quiz.pinned} />
          </button>
          <button onClick={() => setShowShare(true)} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-secondary hover:bg-surface-variant transition-colors" title="Share">
            <Icon name="share" size={20} />
          </button>
          <div className="w-px h-6 bg-border-subtle" />
          <button onClick={retake} className="px-4 py-1.5 rounded border border-border-subtle text-text-muted hover:text-secondary hover:border-secondary transition-colors text-[12px] font-medium">
            Retake
          </button>
          {!submitted ? (
            <button onClick={() => void submit()} className="px-4 py-1.5 rounded bg-accent-teal hover:opacity-90 text-white text-[12px] font-medium transition-colors shadow-sm">
              Submit Quiz
            </button>
          ) : (
            <span className="px-4 py-1.5 rounded bg-success/20 text-success text-[12px] font-medium">
              {finalScore}/{totalQuestions} correct
            </span>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto px-6 py-8 pb-8">
          {/* Quiz header */}
          <div className="mb-8 border-b border-border-subtle pb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{quiz.settings.difficulty}</span>
                <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{quiz.settings.questionType.replace('_', ' ')}</span>
                {quiz.contextUsed && <span className="px-2 py-0.5 rounded-full bg-secondary/20 text-secondary text-[10px] uppercase tracking-wider">Source Context</span>}
              </div>
              <h2 className="text-[32px] font-bold text-on-surface font-geist tracking-tight">{quiz.title}</h2>
              <p className="text-[16px] text-text-muted mt-2 max-w-2xl">{quiz.topic}</p>
            </div>
            <div className="flex items-center bg-surface-container-high rounded p-1 border border-border-subtle shrink-0">
              <button onClick={() => setViewMode('all')} className={`px-3 py-1.5 rounded text-[12px] font-medium transition-all ${viewMode === 'all' ? 'bg-surface-variant text-on-surface shadow-sm' : 'text-text-muted hover:text-on-surface'}`}>All Questions</button>
              <button onClick={() => setViewMode('one')} className={`px-3 py-1.5 rounded text-[12px] font-medium transition-all ${viewMode === 'one' ? 'bg-surface-variant text-on-surface shadow-sm' : 'text-text-muted hover:text-on-surface'}`}>One by One</button>
            </div>
          </div>

          {/* One-by-one nav */}
          {viewMode === 'one' && (
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setSingleIndex((i) => Math.max(0, i - 1))} disabled={singleIndex === 0} className="flex items-center gap-1 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface disabled:opacity-30 transition-colors">
                <Icon name="arrow_back" size={16} /> Prev
              </button>
              <span className="text-[12px] text-text-muted">Question {singleIndex + 1} of {totalQuestions}</span>
              <button onClick={() => setSingleIndex((i) => Math.min(totalQuestions - 1, i + 1))} disabled={singleIndex === totalQuestions - 1} className="flex items-center gap-1 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface disabled:opacity-30 transition-colors">
                Next <Icon name="arrow_forward" size={16} />
              </button>
            </div>
          )}

          {error && <div className="mb-4 bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>}

          {/* Questions */}
          <div className="flex flex-col gap-4">
            {questionsToRender.map((q, localIdx) => {
              const idx = viewMode === 'all' ? localIdx : singleIndex;
              const selected = answers[idx];
              const isActive = !submitted && viewMode === 'one';

              return (
                <div key={`${idx}-${q.question}`} className={`rounded-lg p-6 transition-colors ${isActive ? 'question-active' : 'border border-border-subtle hover:border-outline-variant'}`} style={{ backgroundColor: '#1c1b1b' }}>
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="text-[18px] font-medium text-on-surface font-geist flex gap-3 leading-snug pr-4">
                      <span className={`font-mono text-sm mt-0.5 shrink-0 ${isActive ? 'text-secondary' : 'text-text-muted'}`}>{String(idx + 1).padStart(2, '0')}</span>
                      {q.question}
                    </h3>
                  </div>
                  <div className="flex flex-col gap-3 ml-8">
                    {q.choices.map((choice, cIdx) => {
                      const isCorrect = submitted && cIdx === q.correctIndex;
                      const isWrong = submitted && selected === cIdx && cIdx !== q.correctIndex;
                      const isSelected = selected === cIdx;
                      let cls = 'flex items-center gap-4 p-4 rounded border cursor-pointer transition-colors group';
                      if (submitted) {
                        if (isCorrect) cls += ' quiz-option-correct';
                        else if (isWrong) cls += ' quiz-option-wrong';
                        else cls += ' border-border-subtle opacity-50';
                      } else {
                        cls += isSelected ? ' quiz-option-selected' : ' border-border-subtle hover:bg-surface-variant';
                      }
                      return (
                        <label key={cIdx} className={cls}>
                          <div className={`w-4 h-4 rounded-full border relative shrink-0 ${isSelected || isCorrect ? 'border-secondary' : 'border-outline'}`}>
                            {(isSelected || isCorrect) && <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-secondary block" />}
                          </div>
                          <input type="radio" name={`q-${idx}`} disabled={submitted} checked={isSelected} onChange={() => setAnswers((prev) => ({ ...prev, [idx]: cIdx }))} className="hidden" />
                          <span className={`text-[14px] ${isSelected ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>{choice}</span>
                          {submitted && isCorrect && <Icon name="check_circle" size={18} className="text-success ml-auto shrink-0" fill />}
                          {submitted && isWrong && <Icon name="cancel" size={18} className="text-error ml-auto shrink-0" fill />}
                        </label>
                      );
                    })}
                  </div>
                  {submitted && q.explanation && (
                    <div className="mt-4 ml-8 p-3 bg-surface-container rounded border border-border-subtle">
                      <p className="text-[13px] text-text-muted"><span className="text-secondary font-medium mr-1">Explanation:</span>{q.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </>
  );
}
