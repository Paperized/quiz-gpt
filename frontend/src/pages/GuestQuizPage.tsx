import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { req } from '../api';
import { formatScore, scoreColor } from '../helpers';
import type { GuestQuizData, GuestAttemptResult, PublicQuestion } from '../types';

function selectionMark(question: PublicQuestion, selected: boolean, highlighted: boolean) {
  const boxShape = question.responseType === 'multi_select' ? 'rounded-sm' : 'rounded-full';
  return (
    <div className={`w-4 h-4 border relative shrink-0 ${boxShape} ${selected || highlighted ? 'border-secondary' : 'border-outline'}`}>
      {(selected || highlighted) && <span className={`absolute inset-0.5 bg-secondary block ${boxShape}`} />}
    </div>
  );
}

export function GuestQuizPage() {
  const { token } = useParams<{ token: string }>();
  const [quizData, setQuizData] = useState<GuestQuizData | null>(null);
  const [phase, setPhase] = useState<'loading' | 'error' | 'intro' | 'quiz' | 'result'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [startedAt, setStartedAt] = useState('');
  const [result, setResult] = useState<GuestAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'one'>('all');
  const [singleIndex, setSingleIndex] = useState(0);

  useEffect(() => {
    req<GuestQuizData>(`/public/api/s/${token}`)
      .then((data) => { setQuizData(data); setPhase('intro'); })
      .catch((e) => { setErrorMsg(e instanceof Error ? e.message : 'Failed to load quiz'); setPhase('error'); });
  }, [token]);

  function startQuiz() {
    setStartedAt(new Date().toISOString());
    setAnswers({});
    setSingleIndex(0);
    setPhase('quiz');
  }

  function updateAnswer(question: PublicQuestion, choiceIndex: number) {
    setAnswers((prev) => {
      const current = prev[question.id] ?? [];
      const next = question.responseType === 'multi_select'
        ? (current.includes(choiceIndex)
          ? current.filter((index) => index !== choiceIndex)
          : [...current, choiceIndex].sort((a, b) => a - b))
        : [choiceIndex];

      return { ...prev, [question.id]: next };
    });
  }

  async function submit() {
    if (!quizData) return;
    setSubmitting(true);
    try {
      const payload = quizData.questions.map((question) => ({
        questionId: question.id,
        selectedAnswers: answers[question.id] ?? []
      }));
      const res = await req<GuestAttemptResult>(`/public/api/s/${token}/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload, startedAt, completedAt: new Date().toISOString() }),
      });
      setResult(res);
      setPhase('result');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  const bg = '#141313';
  const cardBg = '#1c1b1b';

  if (phase === 'loading') return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: bg }}>
      <svg className="animate-spin w-8 h-8 text-secondary" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );

  if (phase === 'error') return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: bg }}>
      <div className="max-w-sm w-full text-center space-y-4">
        <Icon name="link_off" size={48} className="text-text-muted mx-auto" />
        <h2 className="text-[20px] font-bold text-on-surface font-geist">Link Unavailable</h2>
        <p className="text-[14px] text-text-muted">{errorMsg}</p>
      </div>
    </div>
  );

  if (phase === 'intro' && quizData) return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: bg }}>
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-primary-container flex items-center justify-center mx-auto mb-4">
            <Icon name="lightbulb" fill size={28} className="text-secondary" />
          </div>
          <h1 className="text-[28px] font-bold text-on-surface font-geist">{quizData.title}</h1>
          <p className="text-[14px] text-text-muted">You've been invited to take this quiz</p>
        </div>

        <div className="border border-border-subtle rounded-xl p-5 space-y-3" style={{ backgroundColor: cardBg }}>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-text-muted font-geist">Guest</span>
            <span className="text-[14px] text-on-surface font-medium">{quizData.guestName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-text-muted font-geist">Questions</span>
            <span className="text-[14px] text-on-surface font-medium">{quizData.questions.length}</span>
          </div>
          {quizData.maxAttempts !== null && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-text-muted font-geist">Attempts</span>
              <span className="text-[14px] text-on-surface font-medium">{quizData.attemptCount} / {quizData.maxAttempts}</span>
            </div>
          )}
        </div>

        <button
          onClick={startQuiz}
          className="w-full bg-secondary hover:opacity-90 text-on-secondary-fixed py-4 rounded-xl text-[16px] font-bold flex items-center justify-center gap-2 transition-all shadow-lg"
        >
          <Icon name="play_arrow" size={22} />
          Start Quiz
        </button>
      </div>
    </div>
  );

  if (phase === 'quiz' && quizData) {
    const totalQ = quizData.questions.length;
    const answeredCount = quizData.questions.filter((question) => (answers[question.id] ?? []).length > 0).length;
    const questionsToRender = viewMode === 'all' ? quizData.questions : [quizData.questions[singleIndex]];

    return (
      <div className="h-screen flex flex-col" style={{ backgroundColor: bg }}>
        <header className="relative flex justify-between items-center h-16 px-6 border-b border-border-subtle shrink-0 sticky top-0 z-10" style={{ backgroundColor: bg }}>
          <div className="flex items-center gap-2">
            <Icon name="lightbulb" fill size={18} className="text-secondary" />
            <span className="text-[14px] font-semibold text-on-surface font-geist truncate hidden sm:block">{quizData.title}</span>
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
            <div className="w-48 h-1 bg-surface-variant rounded-full overflow-hidden">
              <div className="h-full bg-secondary rounded-full transition-all duration-300" style={{ width: `${totalQ > 0 ? (answeredCount / totalQ) * 100 : 0}%` }} />
            </div>
            <span className="text-[11px] text-text-muted">{answeredCount}/{totalQ}</span>
          </div>
          <button
            onClick={() => void submit()}
            disabled={submitting}
            className="px-4 py-1.5 rounded bg-accent-teal hover:opacity-90 disabled:opacity-50 text-white text-[12px] font-medium transition-colors shadow-sm flex items-center gap-2"
          >
            {submitting && <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
            Submit Quiz
          </button>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[900px] mx-auto px-6 py-8">
            <div className="mb-8 border-b border-border-subtle pb-6 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
              <div>
                <h2 className="text-[28px] font-bold text-on-surface font-geist">{quizData.title}</h2>
                <p className="text-[14px] text-text-muted mt-1">Welcome, {quizData.guestName}</p>
              </div>
              <div className="flex items-center bg-surface-container-high rounded p-1 border border-border-subtle shrink-0">
                <button onClick={() => setViewMode('all')} className={`px-3 py-1.5 rounded text-[12px] font-medium transition-all ${viewMode === 'all' ? 'bg-surface-variant text-on-surface shadow-sm' : 'text-text-muted hover:text-on-surface'}`}>All Questions</button>
                <button onClick={() => setViewMode('one')} className={`px-3 py-1.5 rounded text-[12px] font-medium transition-all ${viewMode === 'one' ? 'bg-surface-variant text-on-surface shadow-sm' : 'text-text-muted hover:text-on-surface'}`}>One by One</button>
              </div>
            </div>

            {viewMode === 'one' && (
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setSingleIndex((index) => Math.max(0, index - 1))} disabled={singleIndex === 0} className="flex items-center gap-1 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface disabled:opacity-30 transition-colors">
                  <Icon name="arrow_back" size={16} /> Prev
                </button>
                <span className="text-[12px] text-text-muted">Question {singleIndex + 1} of {totalQ}</span>
                <button onClick={() => setSingleIndex((index) => Math.min(totalQ - 1, index + 1))} disabled={singleIndex === totalQ - 1} className="flex items-center gap-1 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface disabled:opacity-30 transition-colors">
                  Next <Icon name="arrow_forward" size={16} />
                </button>
              </div>
            )}

            {errorMsg && <div className="mb-4 bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{errorMsg}</div>}

            <div className="flex flex-col gap-4">
              {questionsToRender.map((question, localIdx) => {
                const idx = viewMode === 'all' ? localIdx : singleIndex;
                const selected = answers[question.id] ?? [];
                const isActive = viewMode === 'one';

                return (
                  <div key={question.id} className={`rounded-lg p-6 transition-colors ${isActive ? 'question-active' : 'border border-border-subtle hover:border-outline-variant'}`} style={{ backgroundColor: cardBg }}>
                    <div className="flex items-start gap-3 mb-4">
                      <span className={`font-mono text-sm mt-0.5 shrink-0 ${isActive ? 'text-secondary' : 'text-text-muted'}`}>{String(idx + 1).padStart(2, '0')}</span>
                      <div className="flex-1">
                        <h3 className="text-[18px] font-medium text-on-surface font-geist leading-snug">{question.question}</h3>
                        <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">
                          {question.responseType === 'multi_select' ? 'Multi Select' : 'Single Choice'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 ml-8">
                      {question.choices.map((choice, choiceIndex) => {
                        const isSelected = selected.includes(choiceIndex);
                        const cls = `flex items-center gap-4 p-4 rounded border cursor-pointer transition-colors group ${isSelected ? 'quiz-option-selected' : 'border-border-subtle hover:bg-surface-variant'}`;
                        return (
                          <label key={choiceIndex} className={cls}>
                            {selectionMark(question, isSelected, false)}
                            <input
                              type={question.responseType === 'multi_select' ? 'checkbox' : 'radio'}
                              name={`q-${question.id}`}
                              checked={isSelected}
                              onChange={() => updateAnswer(question, choiceIndex)}
                              className="hidden"
                            />
                            <span className={`text-[14px] ${isSelected ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>{choice}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex justify-end">
              <button
                onClick={() => void submit()}
                disabled={submitting}
                className="px-6 py-3 bg-accent-teal hover:opacity-90 disabled:opacity-50 text-white rounded-xl text-[14px] font-bold transition-all shadow-lg flex items-center gap-2"
              >
                {submitting && <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                Submit Quiz
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (phase === 'result' && result && quizData) {
    const pct = Math.round((result.score / result.total) * 100);
    return (
      <div className="h-screen flex flex-col" style={{ backgroundColor: bg }}>
        <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle shrink-0" style={{ backgroundColor: bg }}>
          <div className="flex items-center gap-2">
            <Icon name="lightbulb" fill size={18} className="text-secondary" />
            <span className="text-[14px] font-semibold text-on-surface font-geist">{quizData.title}</span>
          </div>
          <span className={`px-4 py-1.5 rounded text-[12px] font-bold ${scoreColor(pct)}`} style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
            {formatScore(result.score)}/{result.total} · {pct}%
          </span>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[900px] mx-auto px-6 py-8">
            <div className="mb-10 p-6 rounded-xl border border-border-subtle text-center space-y-2" style={{ backgroundColor: cardBg }}>
              <p className="text-[13px] text-text-muted uppercase tracking-widest font-geist">Your Score</p>
              <div className={`text-[56px] font-bold font-geist ${scoreColor(pct)}`}>{pct}%</div>
              <p className="text-[16px] text-text-muted">{formatScore(result.score)} out of {result.total} score</p>
              <p className="text-[13px] text-text-muted">Well done, {quizData.guestName}!</p>
            </div>

            <div className="flex flex-col gap-4">
              {result.questions.map((question, idx) => {
                const correctSet = new Set(question.correctAnswers);
                const selectedSet = new Set(question.userAnswers);
                const skipped = question.userAnswers.length === 0;
                return (
                  <div key={question.id} className="rounded-lg p-6 border border-border-subtle" style={{ backgroundColor: cardBg }}>
                    <div className="flex items-start gap-3 mb-4">
                      <span className="font-mono text-sm text-text-muted mt-0.5 shrink-0">{String(idx + 1).padStart(2, '0')}</span>
                      <div className="flex-1">
                        <h3 className="text-[18px] font-medium text-on-surface font-geist leading-snug">{question.question}</h3>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">
                            {question.responseType === 'multi_select' ? 'Multi Select' : 'Single Choice'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">
                            {formatScore(question.questionScore)} point
                          </span>
                        </div>
                      </div>
                      {skipped && <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px]">Skipped</span>}
                    </div>
                    <div className="flex flex-col gap-3 ml-8">
                      {question.choices.map((choice, choiceIndex) => {
                        const isCorrect = correctSet.has(choiceIndex);
                        const isWrong = selectedSet.has(choiceIndex) && !isCorrect;
                        let cls = 'flex items-center gap-4 p-4 rounded border transition-colors';
                        if (isCorrect) cls += ' quiz-option-correct';
                        else if (isWrong) cls += ' quiz-option-wrong';
                        else cls += ' border-border-subtle opacity-50';
                        return (
                          <div key={choiceIndex} className={cls}>
                            {selectionMark(question, selectedSet.has(choiceIndex), isCorrect)}
                            <span className={`text-[14px] flex-1 ${isCorrect ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>{choice}</span>
                            {isCorrect && <Icon name="check_circle" size={18} className="text-success shrink-0" fill />}
                            {isWrong && <Icon name="cancel" size={18} className="text-error shrink-0" fill />}
                          </div>
                        );
                      })}
                    </div>
                    {question.explanation && (
                      <div className="mt-4 ml-8 p-3 bg-surface-container rounded border border-border-subtle">
                        <p className="text-[13px] text-text-muted"><span className="text-secondary font-medium mr-1">Explanation:</span>{question.explanation}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-8 pt-6 border-t border-border-subtle text-center">
              <p className="text-[13px] text-text-muted">Thanks for completing this quiz!</p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return null;
}
