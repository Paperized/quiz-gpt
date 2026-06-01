import { useEffect, useMemo, useState } from 'react';

type QuizSettings = {
  minQuestions: number;
  maxQuestions: number;
  choicesPerQuestion: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  language: string;
  questionType: 'multiple_choice' | 'true_false' | 'mixed';
};

type QuizQuestion = {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
};

type Quiz = {
  id: string;
  title: string;
  topic: string;
  settings: QuizSettings;
  questions: QuizQuestion[];
  createdAt: string;
  pinned: boolean;
  pinnedAt: string | null;
  contextUsed?: boolean;
};

type AttemptHistory = {
  id: string;
  quizId: string;
  quizTitle: string;
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  timeTakenSeconds: number;
};

type Metrics = {
  totalQuizzes: number;
  totalAttempts: number;
  averageScore: number;
  bestScorePerQuiz: Array<{ quizId: string; quizTitle: string; bestScore: number; }>;
  mostAttemptedQuiz: { quizId: string; quizTitle: string; attempts: number; } | null;
  trendByQuiz: Record<string, { quizTitle: string; points: Array<{ completedAt: string; scorePercent: number; }>; }>;
};

const defaultSettings: QuizSettings = {
  minQuestions: 5,
  maxQuestions: 10,
  choicesPerQuestion: 4,
  difficulty: 'Medium',
  language: 'English',
  questionType: 'mixed'
};

const runtimePublicUrl = window.__APP_CONFIG__?.publicUrl?.trim();
const apiBase = runtimePublicUrl ? runtimePublicUrl.replace(/\/$/, '') : '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, init);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function App() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [settings, setSettings] = useState<QuizSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [documents, setDocuments] = useState<File[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'quiz' | 'results'>('quiz');
  const [history, setHistory] = useState<AttemptHistory[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [historyFilter, setHistoryFilter] = useState({ quizName: '', from: '', to: '' });
  const [resultsTab, setResultsTab] = useState<'history' | 'metrics'>('history');
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [trendQuizId, setTrendQuizId] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [viewMode, setViewMode] = useState<'all' | 'one'>(() => (localStorage.getItem('viewMode') as 'all' | 'one') ?? 'all');
  const [singleIndex, setSingleIndex] = useState(0);

  const selectedQuiz = useMemo(() => quizzes.find((q) => q.id === selectedId) ?? null, [quizzes, selectedId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('viewMode', viewMode);
  }, [viewMode]);

  async function loadQuizzes() {
    const data = await req<Quiz[]>('/api/quizzes');
    setQuizzes(data);
  }

  async function loadResults() {
    setResultsError(null);
    const params = new URLSearchParams();
    if (historyFilter.quizName) params.set('quizName', historyFilter.quizName);
    if (historyFilter.from) params.set('from', historyFilter.from);
    if (historyFilter.to) params.set('to', historyFilter.to);

    try {
      const [h, m] = await Promise.all([
        req<AttemptHistory[]>(`/api/results/history?${params.toString()}`),
        req<Metrics>('/api/results/metrics')
      ]);
      setHistory(h);
      setMetrics(m);
    } catch (e) {
      setResultsError(e instanceof Error ? e.message : 'Failed to load results');
    }
  }

  useEffect(() => {
    void loadQuizzes();
  }, []);

  useEffect(() => {
    if (activeSection === 'results') {
      void loadResults();
    }
  }, [activeSection]);

  useEffect(() => {
    if (!metrics) return;
    const ids = Object.keys(metrics.trendByQuiz);
    if (!ids.length) {
      setTrendQuizId('');
      return;
    }
    if (!ids.includes(trendQuizId)) {
      setTrendQuizId(ids[0]);
    }
  }, [metrics, trendQuizId]);

  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
    setStartedAt(selectedQuiz ? new Date().toISOString() : null);
    setSingleIndex(0);
  }, [selectedId]);

  async function generateQuiz() {
    if (settings.minQuestions > settings.maxQuestions) {
      setError('Min questions cannot be greater than max questions');
      return;
    }
    if (settings.questionType === 'true_false' && settings.choicesPerQuestion !== 2) {
      setError('True/False mode requires exactly 2 choices per question');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('topic', topic);
      form.append('settings', JSON.stringify(settings));
      if (sourceText.trim()) form.append('sourceText', sourceText.trim());
      if (githubRepoUrl.trim()) form.append('githubRepoUrl', githubRepoUrl.trim());
      for (const file of documents) {
        form.append('documents', file);
      }

      const quiz = await req<Quiz>('/api/quizzes/generate', {
        method: 'POST',
        body: form
      });
      setTopic('');
      setSourceText('');
      setGithubRepoUrl('');
      setDocuments([]);
      await loadQuizzes();
      setSelectedId(quiz.id);
      setActiveSection('quiz');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate quiz');
    } finally {
      setLoading(false);
    }
  }

  async function togglePin(quiz: Quiz) {
    await req<Quiz>(`/api/quizzes/${quiz.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: !quiz.pinned })
    });
    await loadQuizzes();
  }

  async function renameQuiz(quiz: Quiz) {
    const title = prompt('New quiz title', quiz.title);
    if (!title) return;
    await req<Quiz>(`/api/quizzes/${quiz.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    await loadQuizzes();
  }

  async function deleteQuiz(quiz: Quiz) {
    if (!confirm(`Delete "${quiz.title}"?`)) return;
    await req<void>(`/api/quizzes/${quiz.id}`, { method: 'DELETE' });
    if (selectedId === quiz.id) setSelectedId(null);
    await loadQuizzes();
  }

  function doShuffle() {
    if (!selectedQuiz) return;
    const shuffledQuestions = shuffleArray(selectedQuiz.questions).map((q) => {
      const choicePairs = q.choices.map((c, i) => ({ c, i }));
      const shuffledChoices = shuffleArray(choicePairs);
      return {
        ...q,
        choices: shuffledChoices.map((x) => x.c),
        correctIndex: shuffledChoices.findIndex((x) => x.i === q.correctIndex)
      };
    });
    setQuizzes((prev) => prev.map((q) => q.id === selectedQuiz.id ? { ...q, questions: shuffledQuestions } : q));
    setAnswers({});
    setSubmitted(false);
    setStartedAt(new Date().toISOString());
  }

  async function submitQuiz() {
    if (!selectedQuiz || !startedAt) return;
    const total = selectedQuiz.questions.length;
    const score = selectedQuiz.questions.reduce((acc, q, i) => acc + ((answers[i] ?? -1) === q.correctIndex ? 1 : 0), 0);
    setSubmitted(true);
    await req('/api/attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quizId: selectedQuiz.id,
        answers: selectedQuiz.questions.map((_, i) => answers[i] ?? -1),
        score,
        total,
        startedAt,
        completedAt: new Date().toISOString()
      })
    });
  }

  function retake() {
    setAnswers({});
    setSubmitted(false);
    setStartedAt(new Date().toISOString());
  }

  const questionsToRender = selectedQuiz
    ? viewMode === 'all' ? selectedQuiz.questions : [selectedQuiz.questions[singleIndex]]
    : [];

  return (
    <div className="app">
      <aside className={`sidebar ${mobileSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <h1>learn-gpt</h1>
          <button onClick={() => setTheme((t) => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        </div>
        <nav className="nav">
          <button className={activeSection === 'quiz' ? 'active' : ''} onClick={() => setActiveSection('quiz')}>Quizzes</button>
          <button className={activeSection === 'results' ? 'active' : ''} onClick={() => setActiveSection('results')}>Results</button>
        </nav>
        <div className="list">
          {quizzes.map((quiz) => (
            <div key={quiz.id} className={`quiz-item ${selectedId === quiz.id ? 'selected' : ''}`} onClick={() => { setSelectedId(quiz.id); setActiveSection('quiz'); setMobileSidebarOpen(false); }}>
              <div className="quiz-item-head">
                <strong>{quiz.title}</strong>
                <button onClick={(e) => { e.stopPropagation(); void togglePin(quiz); }}>{quiz.pinned ? 'Unpin' : 'Pin'}</button>
              </div>
              <small>{new Date(quiz.createdAt).toLocaleDateString()} · {quiz.questions.length} Q</small>
              <div className="row-actions">
                <button onClick={(e) => { e.stopPropagation(); void renameQuiz(quiz); }}>Rename</button>
                <button onClick={(e) => { e.stopPropagation(); void deleteQuiz(quiz); }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </aside>
      {mobileSidebarOpen && <button className="backdrop" onClick={() => setMobileSidebarOpen(false)} aria-label="Close sidebar" />}

      <main className="main">
        <div className="topbar">
          <button className="mobile-only" onClick={() => setMobileSidebarOpen(true)}>Menu</button>
          <span>{activeSection === 'quiz' ? 'Quiz Workspace' : 'Results'}</span>
        </div>

        {activeSection === 'quiz' && !selectedQuiz && (
          <section className="panel">
            <h2>Create a quiz</h2>
            <textarea value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Describe your quiz topic" rows={4} />
            <textarea value={sourceText} onChange={(e) => setSourceText(e.target.value)} placeholder="Optional source text or notes for grounded quiz generation" rows={5} />
            <label>
              Optional GitHub repository URL
              <input value={githubRepoUrl} onChange={(e) => setGithubRepoUrl(e.target.value)} placeholder="https://github.com/owner/repo" />
            </label>
            <label>
              Optional documents (.pdf, .docx, .md, .txt, code files)
              <input
                type="file"
                multiple
                onChange={(e) => setDocuments(Array.from(e.target.files ?? []))}
              />
            </label>
            {documents.length > 0 && <small>{documents.length} document(s) selected</small>}
            <div className="grid">
              <label>Min Questions <input type="number" value={settings.minQuestions} onChange={(e) => setSettings({ ...settings, minQuestions: Number(e.target.value) })} /></label>
              <label>Max Questions <input type="number" value={settings.maxQuestions} onChange={(e) => setSettings({ ...settings, maxQuestions: Number(e.target.value) })} /></label>
              <label>Choices/Question <input type="number" min={2} max={6} value={settings.choicesPerQuestion} onChange={(e) => setSettings({ ...settings, choicesPerQuestion: Number(e.target.value) })} /></label>
              <label>Difficulty
                <select value={settings.difficulty} onChange={(e) => setSettings({ ...settings, difficulty: e.target.value as QuizSettings['difficulty'] })}>
                  <option>Easy</option><option>Medium</option><option>Hard</option>
                </select>
              </label>
              <label>Language <input value={settings.language} onChange={(e) => setSettings({ ...settings, language: e.target.value })} /></label>
              <label>Question Type
                <select value={settings.questionType} onChange={(e) => setSettings({ ...settings, questionType: e.target.value as QuizSettings['questionType'] })}>
                  <option value="multiple_choice">Multiple choice only</option>
                  <option value="true_false">True/False only</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
            </div>
            {error && <p className="error">{error}</p>}
            <button disabled={loading || !topic.trim()} onClick={() => void generateQuiz()}>{loading ? 'Generating...' : 'Generate'}</button>
          </section>
        )}

        {activeSection === 'quiz' && selectedQuiz && (
          <section className="panel">
            <h2>{selectedQuiz.title}</h2>
            <p>{selectedQuiz.topic}</p>
            {selectedQuiz.contextUsed && <small>Generated with retrieved source context</small>}
            <div className="row">
              <label>View
                <select value={viewMode} onChange={(e) => setViewMode(e.target.value as 'all' | 'one')}>
                  <option value="all">All questions</option>
                  <option value="one">One at a time</option>
                </select>
              </label>
              {viewMode === 'one' && (
                <label>Question
                  <select value={singleIndex} onChange={(e) => setSingleIndex(Number(e.target.value))}>
                    {selectedQuiz.questions.map((_, idx) => <option key={idx} value={idx}>{idx + 1}</option>)}
                  </select>
                </label>
              )}
              <button onClick={doShuffle}>Shuffle</button>
              <button onClick={retake}>Retake</button>
              {!submitted && <button onClick={() => void submitQuiz()}>Submit</button>}
            </div>

            {questionsToRender.map((q, localIdx) => {
              const idx = viewMode === 'all' ? localIdx : singleIndex;
              const selected = answers[idx];
              return (
                <article className="question" key={`${idx}-${q.question}`}>
                  <h3>{idx + 1}. {q.question}</h3>
                  {q.choices.map((choice, cIdx) => {
                    const isCorrect = submitted && cIdx === q.correctIndex;
                    const isWrongSelected = submitted && selected === cIdx && cIdx !== q.correctIndex;
                    return (
                      <label key={cIdx} className={`choice ${isCorrect ? 'correct' : ''} ${isWrongSelected ? 'wrong' : ''}`}>
                        <input
                          type="radio"
                          name={`q-${idx}`}
                          disabled={submitted}
                          checked={selected === cIdx}
                          onChange={() => setAnswers((prev) => ({ ...prev, [idx]: cIdx }))}
                        />
                        {choice}
                      </label>
                    );
                  })}
                  {submitted && q.explanation && <p className="explanation">{q.explanation}</p>}
                </article>
              );
            })}
            {submitted && (
              <p className="score">
                Score: {selectedQuiz.questions.reduce((acc, q, i) => acc + ((answers[i] ?? -1) === q.correctIndex ? 1 : 0), 0)}/{selectedQuiz.questions.length}
              </p>
            )}
          </section>
        )}

        {activeSection === 'results' && (
          <section className="panel">
            <h2>Results</h2>
            <div className="nav">
              <button className={resultsTab === 'history' ? 'active' : ''} onClick={() => setResultsTab('history')}>History</button>
              <button className={resultsTab === 'metrics' ? 'active' : ''} onClick={() => setResultsTab('metrics')}>Metrics</button>
            </div>
            {resultsError && <p className="error">{resultsError}</p>}

            {resultsTab === 'history' && (
              <>
                <div className="grid">
                  <label>Quiz Name <input value={historyFilter.quizName} onChange={(e) => setHistoryFilter((p) => ({ ...p, quizName: e.target.value }))} /></label>
                  <label>From <input type="date" value={historyFilter.from} onChange={(e) => setHistoryFilter((p) => ({ ...p, from: e.target.value }))} /></label>
                  <label>To <input type="date" value={historyFilter.to} onChange={(e) => setHistoryFilter((p) => ({ ...p, to: e.target.value }))} /></label>
                  <button onClick={() => void loadResults()}>Apply</button>
                </div>
                {history.map((h) => (
                  <div className="history-item" key={h.id}>
                    <strong>{h.quizTitle}</strong>
                    <span>{formatDate(h.completedAt)}</span>
                    <span>{h.score}/{h.total} ({Math.round((h.score / h.total) * 100)}%)</span>
                    <span>{h.timeTakenSeconds}s</span>
                  </div>
                ))}
              </>
            )}

            {resultsTab === 'metrics' && metrics && (
              <>
                <div className="cards">
                  <div className="card"><strong>{metrics.totalQuizzes}</strong><span>Total quizzes generated</span></div>
                  <div className="card"><strong>{metrics.totalAttempts}</strong><span>Total attempts</span></div>
                  <div className="card"><strong>{metrics.averageScore.toFixed(1)}%</strong><span>Average score</span></div>
                  <div className="card"><strong>{metrics.mostAttemptedQuiz?.quizTitle ?? '-'}</strong><span>Most attempted quiz</span></div>
                </div>
                <h3>Best score per quiz</h3>
                {metrics.bestScorePerQuiz.map((b) => <div key={b.quizId} className="history-item"><span>{b.quizTitle}</span><strong>{b.bestScore.toFixed(1)}%</strong></div>)}
                <h3>Improvement trend</h3>
                {Object.keys(metrics.trendByQuiz).length > 0 && (
                  <label>
                    Quiz
                    <select value={trendQuizId} onChange={(e) => setTrendQuizId(e.target.value)}>
                      {Object.entries(metrics.trendByQuiz).map(([quizId, trend]) => (
                        <option key={quizId} value={quizId}>{trend.quizTitle}</option>
                      ))}
                    </select>
                  </label>
                )}
                {trendQuizId && metrics.trendByQuiz[trendQuizId] && (
                  <div className="trend">
                    <strong>{metrics.trendByQuiz[trendQuizId].quizTitle}</strong>
                    <svg viewBox="0 0 240 80" preserveAspectRatio="none">
                      <polyline
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        points={metrics.trendByQuiz[trendQuizId].points.map((p, i, arr) => `${(i / Math.max(arr.length - 1, 1)) * 240},${80 - (p.scorePercent / 100) * 80}`).join(' ')}
                      />
                    </svg>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
