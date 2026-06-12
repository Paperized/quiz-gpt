import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ShareDialog } from '../components/ShareDialog';
import { RegenerateDialog } from '../components/RegenerateDialog';
import { useQuizzes } from '../context';
import { req } from '../api';
import { formatScore, shuffleArray } from '../helpers';
import { formatDifficultyLabel } from '../difficulty';
import type { FreeTextEvaluation, Quiz, QuizQuestion } from '../types';

type DisplayQuestion = QuizQuestion & { choiceOrder: number[] };
type DisplayQuiz = Omit<Quiz, 'questions'> & { questions: DisplayQuestion[] };
type QuizDraft = {
  answers: Record<string, number[]>;
  freeTextAnswers: Record<string, string>;
  startedAt: string;
  singleIndex: number;
};

function getQuizDraftStorageKey(quizId: string) {
  return `quiz_draft:${quizId}`;
}

function readQuizDraft(quizId: string): QuizDraft | null {
  try {
    const raw = localStorage.getItem(getQuizDraftStorageKey(quizId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuizDraft;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.startedAt !== 'string' || typeof parsed.singleIndex !== 'number' || typeof parsed.answers !== 'object') {
      return null;
    }
    if (typeof parsed.freeTextAnswers !== 'object') parsed.freeTextAnswers = {};
    return parsed;
  } catch {
    return null;
  }
}

function clearQuizDraft(quizId: string) {
  localStorage.removeItem(getQuizDraftStorageKey(quizId));
}

function toDisplayQuestion(question: QuizQuestion): DisplayQuestion {
  return {
    ...question,
    choiceOrder: question.choices.map((_, index) => index)
  };
}

function toDisplayQuiz(quiz: Quiz): DisplayQuiz {
  return {
    ...quiz,
    questions: quiz.questions.map(toDisplayQuestion)
  };
}

function selectionMark(question: DisplayQuestion, selected: boolean, highlighted: boolean) {
  const boxShape = question.responseType === 'multi_select' ? 'rounded-sm' : 'rounded-full';
  if (!highlighted) {
    return (
      <div className={`w-4 h-4 border relative shrink-0 ${boxShape} ${selected ? 'border-secondary' : 'border-outline'}`}>
        {selected && <span className={`absolute inset-0.5 bg-secondary block ${boxShape}`} />}
      </div>
    );
  }

  return (
    <div className={`w-4 h-4 border relative shrink-0 ${boxShape} ${selected || highlighted ? 'border-secondary' : 'border-outline'}`}>
      {(selected || highlighted) && <span className={`absolute inset-0.5 bg-secondary block ${boxShape}`} />}
    </div>
  );
}

export function QuizPage() {
  const { id } = useParams<{ id: string }>();
  const { quizzes, reload } = useQuizzes();
  const navigate = useNavigate();

  const [localQuizzes, setLocalQuizzes] = useState<DisplayQuiz[]>(() => quizzes.map(toDisplayQuiz));
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [freeTextAnswers, setFreeTextAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submittedScore, setSubmittedScore] = useState<number | null>(null);
  const [evaluations, setEvaluations] = useState<FreeTextEvaluation[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'one'>(() => (localStorage.getItem('viewMode') as 'all' | 'one') ?? 'all');
  const [singleIndex, setSingleIndex] = useState(0);
  const [showShare, setShowShare] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => { setLocalQuizzes(quizzes.map(toDisplayQuiz)); }, [quizzes]);
  useEffect(() => { localStorage.setItem('viewMode', viewMode); }, [viewMode]);
  useEffect(() => {
    if (!id) return;
    const draft = readQuizDraft(id);
    setAnswers(draft?.answers ?? {});
    setFreeTextAnswers(draft?.freeTextAnswers ?? {});
    setStartedAt(draft?.startedAt ?? new Date().toISOString());
    setSingleIndex(draft?.singleIndex ?? 0);
    setSubmitted(false);
    setSubmittedScore(null);
    setEvaluations(null);
    setSubmitting(false);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (!id || submitted) return;
    const draft: QuizDraft = { answers, freeTextAnswers, startedAt, singleIndex };
    localStorage.setItem(getQuizDraftStorageKey(id), JSON.stringify(draft));
  }, [answers, freeTextAnswers, id, singleIndex, startedAt, submitted]);

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
  const answeredCount = quiz.questions.filter((question) =>
    question.responseType === 'free_text'
      ? (freeTextAnswers[question.id] ?? '').trim().length > 0
      : (answers[question.id] ?? []).length > 0
  ).length;

  function shuffle() {
    const shuffled = shuffleArray(quiz.questions).map((question) => {
      const pairs = question.choices.map((choice, index) => ({ choice, index, originalIndex: question.choiceOrder[index] }));
      const shuffledChoices = shuffleArray(pairs);
      const choiceOrder = shuffledChoices.map((entry) => entry.originalIndex);
      const correctSet = new Set(question.correctAnswers);
      const remappedCorrectAnswers = shuffledChoices
        .map((entry, index) => (correctSet.has(entry.index) ? index : -1))
        .filter((index) => index >= 0);

      return {
        ...question,
        choices: shuffledChoices.map((entry) => entry.choice),
        choiceOrder,
        correctAnswers: remappedCorrectAnswers
      };
    });

    setLocalQuizzes((prev) => prev.map((entry) => entry.id === quiz.id ? { ...entry, questions: shuffled } : entry));
    setAnswers({});
    setFreeTextAnswers({});
    setSubmitted(false);
    setSubmittedScore(null);
    setEvaluations(null);
    setSubmitting(false);
    setStartedAt(new Date().toISOString());
  }

  function updateAnswer(question: DisplayQuestion, choiceIndex: number) {
    if (submitted) return;

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

  function updateFreeText(questionId: string, text: string) {
    if (submitted) return;
    setFreeTextAnswers((prev) => ({ ...prev, [questionId]: text }));
  }

  async function togglePin(e: React.MouseEvent) {
    e.stopPropagation();
    await req<Quiz>(`/api/quizzes/${quiz.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !quiz.pinned }) });
    await reload();
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const payload = quiz.questions.map((question) => ({
        questionId: question.id,
        selectedAnswers: (answers[question.id] ?? []).map((index) => question.choiceOrder[index]),
        freeText: question.responseType === 'free_text' ? (freeTextAnswers[question.id] ?? '') : undefined
      }));

      const result = await req<{ score: number; total: number; evaluations: FreeTextEvaluation[] | null }>('/api/attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quizId: quiz.id, answers: payload, startedAt, completedAt: new Date().toISOString() }),
      });
      clearQuizDraft(quiz.id);
      setSubmittedScore(result.score);
      setEvaluations(result.evaluations);
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  function retake() {
    setAnswers({});
    setFreeTextAnswers({});
    setSubmitted(false);
    setSubmittedScore(null);
    setEvaluations(null);
    setSubmitting(false);
    setStartedAt(new Date().toISOString());
    setSingleIndex(0);
  }

  return (
    <>
      {showShare && <ShareDialog quizId={quiz.id} onClose={() => setShowShare(false)} />}
      {showRegenerate && (
        <RegenerateDialog
          quiz={quiz}
          onClose={() => setShowRegenerate(false)}
          onComplete={(result) => {
            setShowRegenerate(false);
            void (async () => {
              await reload();
              if (result && 'id' in result) {
                navigate(`/quiz/${result.id}`);
              }
            })();
          }}
        />
      )}
      <header className="relative flex justify-between items-center h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <span className="text-[14px] font-semibold text-on-surface font-geist truncate">{quiz.title}</span>
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
          <button onClick={() => setShowRegenerate(true)} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-secondary hover:bg-surface-variant transition-colors" title="Regenerate">
            <Icon name="autorenew" size={20} />
          </button>
          <div className="w-px h-6 bg-border-subtle" />
          <button onClick={retake} className="px-4 py-1.5 rounded border border-border-subtle text-text-muted hover:text-secondary hover:border-secondary transition-colors text-[12px] font-medium">
            Retake
          </button>
          {!submitted ? (
            <button
              onClick={() => void submit()}
              disabled={submitting}
              className="px-4 py-1.5 rounded bg-accent-teal hover:opacity-90 disabled:opacity-50 text-white text-[12px] font-medium transition-colors shadow-sm flex items-center gap-2"
            >
              {submitting && <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
              {submitting ? 'Evaluating...' : 'Submit Quiz'}
            </button>
          ) : (
            <span className="px-4 py-1.5 rounded bg-success/20 text-success text-[12px] font-medium">
              {formatScore(submittedScore ?? 0)}/{totalQuestions} score
            </span>
          )}
        </div>
      </header>

      <main ref={scrollContainerRef} className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto px-6 py-8 pb-8">
          <div className="mb-8 border-b border-border-subtle pb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{formatDifficultyLabel(quiz.settings.difficulty)}</span>
                <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">{quiz.settings.questionType.map(t => t.replace('_', ' ')).join(', ')}</span>
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

          {viewMode === 'one' && (
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setSingleIndex((index) => Math.max(0, index - 1))} disabled={singleIndex === 0} className="flex items-center gap-1 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface disabled:opacity-30 transition-colors">
                <Icon name="arrow_back" size={16} /> Prev
              </button>
              <span className="text-[12px] text-text-muted">Question {singleIndex + 1} of {totalQuestions}</span>
              <button onClick={() => setSingleIndex((index) => Math.min(totalQuestions - 1, index + 1))} disabled={singleIndex === totalQuestions - 1} className="flex items-center gap-1 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface disabled:opacity-30 transition-colors">
                Next <Icon name="arrow_forward" size={16} />
              </button>
            </div>
          )}

          {error && <div className="mb-4 bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>}

          <div className="flex flex-col gap-4">
            {questionsToRender.map((question, localIdx) => {
              const idx = viewMode === 'all' ? localIdx : singleIndex;
              const selected = answers[question.id] ?? [];
              const isActive = !submitted && viewMode === 'one';
              const correctSet = new Set(question.correctAnswers);

              return (
                <div key={question.id} className={`rounded-lg p-6 transition-colors ${isActive ? 'question-active' : 'border border-border-subtle hover:border-outline-variant'}`} style={{ backgroundColor: '#1c1b1b' }}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-[18px] font-medium text-on-surface font-geist flex gap-3 leading-snug pr-4">
                        <span className={`font-mono text-sm mt-0.5 shrink-0 ${isActive ? 'text-secondary' : 'text-text-muted'}`}>{String(idx + 1).padStart(2, '0')}</span>
                        {question.question}
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider">
                        {question.responseType === 'multi_select' ? 'Multi Select' : question.responseType === 'free_text' ? 'Free Text' : 'Single Choice'}
                      </span>
                    </div>
                  </div>
                  {question.responseType === 'free_text' ? (
                    <div className="flex flex-col gap-3 ml-8">
                      {!submitted ? (
                        <textarea
                          className="w-full bg-[#0D0D0D] border border-border-subtle rounded px-4 py-3 text-[14px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-accent-teal transition-colors resize-y min-h-[120px]"
                          placeholder="Type your answer..."
                          value={freeTextAnswers[question.id] ?? ''}
                          onChange={(e) => updateFreeText(question.id, e.target.value)}
                        />
                      ) : (
                        <div className="space-y-3">
                          <div className="p-4 bg-[#0D0D0D] border border-border-subtle rounded">
                            <p className="text-[11px] text-text-muted mb-1 uppercase tracking-wider">Your answer</p>
                            <p className="text-[14px] text-on-surface whitespace-pre-wrap">{freeTextAnswers[question.id] ?? '(no answer)'}</p>
                          </div>
                          {(() => {
                            const evaluation = evaluations?.find((e) => e.questionId === question.id);
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
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 ml-8">
                      {question.choices.map((choice, choiceIndex) => {
                      const isSelected = selected.includes(choiceIndex);
                      const isCorrect = submitted && correctSet.has(choiceIndex);
                      const isWrong = submitted && isSelected && !correctSet.has(choiceIndex);
                      let cls = 'flex items-center gap-4 p-4 rounded border cursor-pointer transition-colors group';
                      if (submitted) {
                        if (isCorrect) cls += ' quiz-option-correct';
                        else if (isWrong) cls += ' quiz-option-wrong';
                        else cls += ' border-border-subtle opacity-50';
                      } else {
                        cls += isSelected ? ' quiz-option-selected' : ' border-border-subtle hover:bg-surface-variant';
                      }

                      return (
                        <label key={choiceIndex} className={cls}>
                          {selectionMark(question, isSelected, isCorrect)}
                          <input
                            type={question.responseType === 'multi_select' ? 'checkbox' : 'radio'}
                            name={`q-${question.id}`}
                            disabled={submitted}
                            checked={isSelected}
                            onChange={() => updateAnswer(question, choiceIndex)}
                            className="hidden"
                          />
                          <span className={`text-[14px] ${isSelected ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>{choice}</span>
                          {submitted && isCorrect && <Icon name="check_circle" size={18} className="text-success ml-auto shrink-0" fill />}
                          {submitted && isWrong && <Icon name="cancel" size={18} className="text-error ml-auto shrink-0" fill />}
                        </label>
                      );
                    })}
                  </div>
                  )}
                  {submitted && question.explanation && (
                    <div className="mt-4 ml-8 p-3 bg-surface-container rounded border border-border-subtle">
                      <p className="text-[13px] text-text-muted"><span className="text-secondary font-medium mr-1">Explanation:</span>{question.explanation}</p>
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
