import { useEffect, useMemo, useState, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams, useLocation, Navigate } from 'react-router-dom';

// ─── Types ────────────────────────────────────────────────────────────────────

type QuizSettings = {
  numQuestions: number;
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
  bestScorePerQuiz: Array<{ quizId: string; quizTitle: string; bestScore: number }>;
  mostAttemptedQuiz: { quizId: string; quizTitle: string; attempts: number } | null;
  trendByQuiz: Record<string, { quizTitle: string; points: Array<{ completedAt: string; scorePercent: number }> }>;
};

type AttemptReview = {
  id: string;
  quizId: string;
  answers: number[];
  score: number;
  total: number;
  startedAt: string;
  completedAt: string;
  timeTakenSeconds: number;
  quiz: Quiz;
};

// ─── API ─────────────────────────────────────────────────────────────────────

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

// ─── Shared Context ───────────────────────────────────────────────────────────

type QuizzesCtx = {
  quizzes: Quiz[];
  reload: () => Promise<void>;
};

const QuizzesContext = createContext<QuizzesCtx>({ quizzes: [], reload: async () => {} });
const useQuizzes = () => useContext(QuizzesContext);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const defaultSettings: QuizSettings = {
  numQuestions: 10,
  choicesPerQuestion: 4,
  difficulty: 'Medium',
  language: 'English',
  questionType: 'mixed',
};

function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function scoreColor(pct: number) {
  if (pct >= 80) return 'text-success';
  if (pct >= 60) return 'text-yellow-400';
  return 'text-error';
}

function formatSeconds(s: number) {
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Icon({ name, fill, size = 20, className = '' }: { name: string; fill?: boolean; size?: number; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: size, fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0" }}
    >
      {name}
    </span>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { quizzes, reload } = useQuizzes();
  const navigate = useNavigate();
  const location = useLocation();

  const pinnedQuizzes = useMemo(() => quizzes.filter((q) => q.pinned), [quizzes]);
  const recentQuizzes = useMemo(
    () => [...quizzes].filter((q) => !q.pinned).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
    [quizzes]
  );

  const isResults = location.pathname === '/results';
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

        {/* Results nav */}
        <ul className="px-2">
          <li>
            <button
              onClick={() => { navigate('/results'); onClose(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded transition-colors duration-200 ${isResults ? 'bg-surface-container-highest text-on-surface border-l-2 border-secondary' : 'text-text-muted hover:text-on-surface hover:bg-surface-variant'}`}
            >
              <Icon name="bar_chart" size={18} className={isResults ? 'text-secondary' : ''} />
              <span className="text-[12px] font-medium">Results</span>
            </button>
          </li>
        </ul>

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
          <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.15em] mb-2 px-1">Recent Activity</h3>
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
          <a href="#" className="flex items-center gap-3 text-text-muted hover:text-on-surface px-4 py-2 rounded hover:bg-surface-variant transition-colors">
            <Icon name="help" size={18} />
            <span className="text-[12px]">Help</span>
          </a>
        </div>
      </div>
    </nav>
  );
}

// ─── Layout wrapper ───────────────────────────────────────────────────────────

function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div style={{ backgroundColor: '#141313' }} className="text-on-surface antialiased flex h-screen overflow-hidden">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && (
        <button className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />
      )}
      <div className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-border-subtle sticky top-0 z-40" style={{ backgroundColor: '#141313' }}>
          <button onClick={() => navigate('/')} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Icon name="lightbulb" fill size={18} className="text-secondary" />
              <span className="text-[18px] font-bold text-on-surface font-geist">QuizGPT</span>
            </button>
          <button onClick={() => setSidebarOpen(true)} className="text-on-surface">
            <Icon name="menu" size={24} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

// ─── Create Quiz Page (/') ────────────────────────────────────────────────────

function CreateQuizPage() {
  const { reload } = useQuizzes();
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [settings, setSettings] = useState<QuizSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [documents, setDocuments] = useState<File[]>([]);

  async function generate() {
    if (settings.questionType === 'true_false' && settings.choicesPerQuestion !== 2) { setError('True/False requires 2 choices'); return; }
    setLoading(true); setError(null);
    try {
      const form = new FormData();
      form.append('topic', topic);
      form.append('settings', JSON.stringify(settings));
      if (sourceText.trim()) form.append('sourceText', sourceText.trim());
      if (githubRepoUrl.trim()) form.append('githubRepoUrl', githubRepoUrl.trim());
      for (const f of documents) form.append('documents', f);
      const quiz = await req<Quiz>('/api/quizzes/generate', { method: 'POST', body: form });
      await reload();
      navigate(`/quiz/${quiz.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate quiz');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
      <div className="max-w-[1200px] mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-[32px] font-bold text-on-surface mb-2 font-geist">What shall we test today?</h2>
          <p className="text-[16px] text-text-muted">Configure your parameters and let AI generate a comprehensive assessment.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left */}
          <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
            {/* Topic */}
            <div className="bg-surface-container rounded-xl border border-border-subtle overflow-hidden focus-within:border-secondary transition-colors shadow-sm">
              <div className="p-4 border-b border-border-subtle bg-surface-container-low flex justify-between items-center">
                <label className="text-[12px] font-medium text-on-surface flex items-center gap-2 font-geist" htmlFor="quiz-topic">
                  <Icon name="edit_note" size={16} className="text-text-muted" />
                  Primary Topic or Instruction
                </label>
              </div>
              <textarea
                id="quiz-topic"
                className="w-full bg-transparent border-none text-[16px] text-on-surface placeholder:text-on-primary-container focus:ring-0 p-6 resize-none"
                placeholder="e.g., Generate a quiz about the causes and consequences of the Industrial Revolution..."
                rows={6}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </div>

            {/* Sources */}
            <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
              <div className="p-4 border-b border-border-subtle bg-surface-container-low">
                <h3 className="text-[12px] font-medium text-on-surface flex items-center gap-2 font-geist">
                  <Icon name="library_add" size={16} className="text-text-muted" />
                  Additional Context Sources (Optional)
                </h3>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-border-subtle rounded-lg p-3 hover:border-outline-variant transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-surface-bright flex items-center justify-center shrink-0">
                      <Icon name="link" size={18} className="text-text-muted" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[12px] font-medium text-on-surface mb-1 font-geist">GitHub or Web URL</label>
                      <input
                        className="w-full bg-transparent border-b border-border-subtle focus:border-secondary text-[14px] text-on-surface py-1.5 px-2 focus:ring-0 focus:outline-none"
                        placeholder="https://github.com/owner/repo"
                        value={githubRepoUrl}
                        onChange={(e) => setGithubRepoUrl(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
                <div className="border border-border-subtle border-dashed rounded-lg p-3 hover:border-outline-variant transition-colors relative flex items-center justify-center min-h-[72px]">
                  {documents.length > 0 ? (
                    <div className="flex flex-col items-center justify-center gap-1">
                      <Icon name="description" size={32} className="text-secondary" />
                      <span className="text-[12px] text-secondary">{documents.length} file(s) selected</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1">
                      <Icon name="upload_file" size={32} className="text-text-muted" />
                      <span className="text-[12px] text-text-muted">Upload Document (.pdf, .txt, .docx)</span>
                    </div>
                  )}
                  <input className="absolute inset-0 opacity-0 cursor-pointer" type="file" multiple onChange={(e) => setDocuments(Array.from(e.target.files ?? []))} />
                </div>
              </div>
              <div className="px-4 pb-4">
                <label className="block text-[12px] font-medium text-on-surface mb-2 font-geist">Paste source text (optional)</label>
                <textarea
                  className="w-full bg-surface-container rounded border border-border-subtle text-[14px] text-on-surface placeholder:text-text-muted focus:ring-0 focus:border-secondary p-3 resize-none"
                  placeholder="Paste notes, documentation, or any text to ground the quiz..."
                  rows={3}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Right: settings */}
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-4">
            <div className="bg-surface-container rounded-xl border border-border-subtle p-6 flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <Icon name="settings_suggest" size={20} className="text-secondary" />
                <h3 className="text-[18px] font-medium text-on-surface font-geist">Configuration</h3>
              </div>

              {/* Question count */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[12px] font-medium text-on-surface font-geist">Number of Questions</label>
                  <span className="text-[12px] font-medium text-secondary">{settings.numQuestions}</span>
                </div>
                <input
                  className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-accent-teal"
                  max={40} min={1} type="range" value={settings.numQuestions}
                  onChange={(e) => setSettings({ ...settings, numQuestions: +e.target.value })}
                />
                <div className="flex justify-between text-[12px] text-text-muted opacity-50"><span>1</span><span>40</span></div>
              </div>

              {/* Difficulty */}
              <div className="space-y-2">
                <label className="text-[12px] font-medium text-on-surface block font-geist">Difficulty Level</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setSettings({ ...settings, difficulty: d })}
                      className={`text-center py-2 border rounded text-[12px] font-medium transition-colors ${settings.difficulty === d ? 'border-secondary text-secondary bg-secondary/10' : 'border-border-subtle text-text-muted hover:border-outline-variant'}`}
                    >{d}</button>
                  ))}
                </div>
              </div>

              {/* Question type */}
              <div className="space-y-2">
                <label className="text-[12px] font-medium text-on-surface block font-geist">Question Type</label>
                <select
                  className="w-full bg-surface border border-border-subtle text-on-surface text-[14px] rounded focus:border-secondary focus:ring-0 p-2.5"
                  value={settings.questionType}
                  onChange={(e) => {
                    const qt = e.target.value as QuizSettings['questionType'];
                    setSettings({ ...settings, questionType: qt, choicesPerQuestion: qt === 'true_false' ? 2 : settings.choicesPerQuestion });
                  }}
                >
                  <option value="multiple_choice">Multiple Choice</option>
                  <option value="true_false">True / False</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>

              {/* Choices per question */}
              {settings.questionType !== 'true_false' && (
                <div className="space-y-2">
                  <label className="text-[12px] font-medium text-on-surface block font-geist">Choices per Question</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSettings({ ...settings, choicesPerQuestion: Math.max(2, settings.choicesPerQuestion - 1) })} className="w-8 h-8 rounded border border-border-subtle flex items-center justify-center text-text-muted hover:border-outline-variant">-</button>
                    <span className="w-12 text-center text-[14px] text-on-surface">{settings.choicesPerQuestion}</span>
                    <button onClick={() => setSettings({ ...settings, choicesPerQuestion: Math.min(6, settings.choicesPerQuestion + 1) })} className="w-8 h-8 rounded border border-border-subtle flex items-center justify-center text-text-muted hover:border-outline-variant">+</button>
                  </div>
                </div>
              )}

              {/* Language */}
              <div className="space-y-2">
                <label className="text-[12px] font-medium text-on-surface block font-geist">Language</label>
                <select
                  className="w-full bg-surface border border-border-subtle text-on-surface text-[14px] rounded focus:border-secondary focus:ring-0 p-2.5"
                  value={settings.language}
                  onChange={(e) => setSettings({ ...settings, language: e.target.value })}
                >
                  <option value="English">English</option>
                  <option value="Italian">Italian</option>
                  <option value="Spanish">Spanish</option>
                  <option value="French">French</option>
                  <option value="German">German</option>
                </select>
              </div>
            </div>

            {error && (
              <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>
            )}

            <button
              disabled={loading || !topic.trim()}
              onClick={() => void generate()}
              className="w-full bg-secondary hover:opacity-90 disabled:opacity-60 text-on-secondary-fixed py-4 rounded-xl text-[18px] font-bold flex items-center justify-center gap-3 transition-all shadow-lg relative overflow-hidden"
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating quiz...
                </>
              ) : (
                <>
                  <Icon name="bolt" size={24} />
                  Generate Quiz
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-16 text-center opacity-40">
          <p className="text-[12px] text-text-muted">Powered by AI · Review outputs before sharing</p>
        </div>
      </div>
    </div>
  );
}

// ─── Quiz Page (/quiz/:id) ────────────────────────────────────────────────────

function QuizPage() {
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
      {/* Topbar */}
      <header className="flex justify-between items-center h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <div className="flex items-center gap-2 text-text-muted min-w-0">
          <button onClick={() => navigate('/')} className="hover:text-on-surface transition-colors text-[12px] hidden md:block shrink-0">New Quiz</button>
          <Icon name="chevron_right" size={16} className="hidden md:block shrink-0" />
          <span className="text-[12px] text-on-surface truncate">{quiz.title}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={shuffle} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-secondary hover:bg-surface-variant transition-colors" title="Shuffle">
            <Icon name="shuffle" size={20} />
          </button>
          <button onClick={togglePin} className="w-8 h-8 flex items-center justify-center rounded text-text-muted hover:text-secondary hover:bg-surface-variant transition-colors">
            <Icon name="push_pin" size={20} fill={quiz.pinned} />
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

          {/* Progress */}
          <div className="mt-8 pt-6 border-t border-border-subtle flex justify-between items-center text-text-muted">
            <span className="text-[12px]">{answeredCount} of {totalQuestions} Answered</span>
            <div className="w-48 h-1.5 bg-surface-variant rounded-full overflow-hidden">
              <div className="h-full bg-secondary rounded-full transition-all" style={{ width: `${totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0}%` }} />
            </div>
            {submitted && <span className={`text-[12px] font-bold ${scoreColor(Math.round((finalScore / totalQuestions) * 100))}`}>Score: {Math.round((finalScore / totalQuestions) * 100)}%</span>}
          </div>
        </div>
      </main>
    </>
  );
}

// ─── Results Page (/results) ──────────────────────────────────────────────────

function ResultsPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<AttemptHistory[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [resultsTab, setResultsTab] = useState<'history' | 'metrics'>('history');
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [trendQuizId, setTrendQuizId] = useState('');

  async function load() {
    setResultsError(null);
    const params = new URLSearchParams();
    if (search) params.set('quizName', search);
    try {
      const [h, m] = await Promise.all([
        req<AttemptHistory[]>(`/api/results/history?${params.toString()}`),
        req<Metrics>('/api/results/metrics'),
      ]);
      setHistory(h);
      setMetrics(m);
    } catch (e) {
      setResultsError(e instanceof Error ? e.message : 'Failed to load results');
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!metrics) return;
    const ids = Object.keys(metrics.trendByQuiz);
    if (ids.length && !ids.includes(trendQuizId)) setTrendQuizId(ids[0]);
  }, [metrics]);

  const trendPoints = trendQuizId && metrics?.trendByQuiz[trendQuizId]?.points;

  return (
    <>
      <header className="flex items-center justify-between px-6 py-5 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[18px] font-semibold text-on-surface font-geist">Performance Results</h2>
        <button onClick={() => void load()} className="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-secondary hover:border-secondary transition-colors bg-surface-container-low">
          <Icon name="refresh" size={16} /> Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          {resultsError && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{resultsError}</div>}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border-subtle">
            {(['history', 'metrics'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setResultsTab(tab)}
                className={`px-6 py-3 text-[12px] font-medium capitalize transition-colors ${resultsTab === tab ? 'text-primary font-bold border-b-2 border-secondary' : 'text-text-muted hover:text-secondary'}`}
              >{tab}</button>
            ))}
          </div>

          {/* History */}
          {resultsTab === 'history' && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4 bg-surface-container-low p-4 rounded-lg border border-border-subtle">
                <div className="relative flex-1 max-w-sm">
                  <Icon name="search" size={18} className="text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className="w-full bg-surface-dim border border-border-subtle rounded pl-10 pr-4 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal placeholder:text-text-muted"
                    placeholder="Search quizzes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <button onClick={() => void load()} className="px-3 py-2 bg-surface border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface transition-colors">Apply</button>
              </div>

              <div className="border border-border-subtle rounded-lg bg-surface-container-low overflow-hidden">
                <div className="grid grid-cols-12 gap-4 p-4 border-b border-border-subtle bg-surface-variant/50 text-[12px] font-medium text-text-muted">
                  <div className="col-span-5">Quiz Name</div>
                  <div className="col-span-3 hidden sm:block">Date</div>
                  <div className="col-span-2">Score</div>
                  <div className="col-span-2 text-right">Time</div>
                </div>
                {history.length === 0 ? (
                  <div className="p-8 text-center text-text-muted text-[14px]">No attempts yet. Generate and take a quiz first!</div>
                ) : history.map((h) => {
                  const pct = Math.round((h.score / h.total) * 100);
                  return (
                    <div key={h.id} onClick={() => navigate(`/review/${h.id}`)} className="grid grid-cols-12 gap-4 p-4 border-b border-border-subtle hover:bg-surface-variant/30 transition-colors items-center last:border-b-0 cursor-pointer group">
                      <div className="col-span-5 flex flex-col">
                        <span className="text-[14px] text-on-surface font-medium group-hover:text-accent-teal transition-colors">{h.quizTitle}</span>
                        <span className="text-[12px] text-text-muted">{h.score}/{h.total} questions</span>
                      </div>
                      <div className="col-span-3 hidden sm:block text-[14px] text-text-muted">{new Date(h.completedAt).toLocaleDateString()}</div>
                      <div className="col-span-2 flex items-center gap-2">
                        <span className={`text-[14px] font-medium ${scoreColor(pct)}`}>{pct}%</span>
                        <div className="w-12 h-1.5 bg-surface-bright rounded-full hidden lg:block overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 80 ? 'bg-success' : pct >= 60 ? 'bg-yellow-400' : 'bg-error'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="col-span-2 text-right flex items-center justify-end gap-1 text-[14px] text-text-muted">
                        <Icon name="schedule" size={16} />{formatSeconds(h.timeTakenSeconds)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Metrics */}
          {resultsTab === 'metrics' && (
            <div className="flex flex-col gap-6">
              {!metrics ? (
                <div className="p-8 text-center text-text-muted text-[14px]">Loading metrics...</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: 'Total Quizzes', value: metrics.totalQuizzes, icon: 'library_books', sub: null },
                      { label: 'Total Attempts', value: metrics.totalAttempts, icon: 'repeat', sub: `Avg ${(metrics.totalAttempts / Math.max(metrics.totalQuizzes, 1)).toFixed(1)} per quiz` },
                      { label: 'Avg Score', value: `${metrics.averageScore.toFixed(1)}%`, icon: 'analytics', sub: null },
                      { label: 'Most Attempted', value: metrics.mostAttemptedQuiz?.quizTitle ?? '-', icon: 'local_fire_department', sub: metrics.mostAttemptedQuiz ? `${metrics.mostAttemptedQuiz.attempts} attempts` : null },
                    ].map((card) => (
                      <div key={card.label} className="border border-border-subtle rounded-lg bg-surface-container-low p-6 flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-text-muted uppercase tracking-wider font-geist">{card.label}</span>
                          <Icon name={card.icon} size={20} className="text-primary" />
                        </div>
                        <div className="text-[32px] font-bold text-on-surface font-geist mt-2 leading-none">{card.value}</div>
                        {card.sub && <div className="text-[12px] text-text-muted mt-1">{card.sub}</div>}
                      </div>
                    ))}
                  </div>

                  {trendQuizId && trendPoints && trendPoints.length > 0 && (
                    <div className="border border-border-subtle rounded-lg bg-surface-container-low p-6">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-[18px] font-medium text-on-surface font-geist">Performance Trend</h3>
                        <select className="bg-surface-dim border border-border-subtle rounded px-3 py-1.5 text-[12px] text-on-surface focus:outline-none" value={trendQuizId} onChange={(e) => setTrendQuizId(e.target.value)}>
                          {Object.entries(metrics.trendByQuiz).map(([id, t]) => <option key={id} value={id}>{t.quizTitle}</option>)}
                        </select>
                      </div>
                      <div className="relative w-full h-48 border-l border-b border-border-subtle">
                        <svg className="absolute left-0 top-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                          <defs>
                            <linearGradient id="chartGrad" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="#10A37F" stopOpacity="0.3" />
                              <stop offset="100%" stopColor="#10A37F" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <polygon fill="url(#chartGrad)" points={`0,100 ${trendPoints.map((p, i) => `${(i / Math.max(trendPoints.length - 1, 1)) * 100},${100 - p.scorePercent}`).join(' ')} ${100},100`} />
                          <polyline fill="none" stroke="#10A37F" strokeWidth="1.5" strokeLinejoin="round" points={trendPoints.map((p, i) => `${(i / Math.max(trendPoints.length - 1, 1)) * 100},${100 - p.scorePercent}`).join(' ')} />
                          {trendPoints.map((p, i) => <circle key={i} cx={(i / Math.max(trendPoints.length - 1, 1)) * 100} cy={100 - p.scorePercent} r="2" fill="#141313" stroke="#10A37F" strokeWidth="1.5" />)}
                        </svg>
                      </div>
                    </div>
                  )}

                  {metrics.bestScorePerQuiz.length > 0 && (
                    <div className="border border-border-subtle rounded-lg bg-surface-container-low overflow-hidden">
                      <div className="p-4 border-b border-border-subtle">
                        <h3 className="text-[14px] font-medium text-on-surface font-geist">Best Score per Quiz</h3>
                      </div>
                      {metrics.bestScorePerQuiz.map((b) => (
                        <div key={b.quizId} className="flex items-center justify-between p-4 border-b border-border-subtle last:border-b-0 hover:bg-surface-variant/20 transition-colors">
                          <span className="text-[14px] text-on-surface">{b.quizTitle}</span>
                          <div className="flex items-center gap-3">
                            <div className="w-24 h-1.5 bg-surface-bright rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${b.bestScore >= 80 ? 'bg-success' : b.bestScore >= 60 ? 'bg-yellow-400' : 'bg-error'}`} style={{ width: `${b.bestScore}%` }} />
                            </div>
                            <span className={`text-[14px] font-bold ${scoreColor(b.bestScore)}`}>{b.bestScore.toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Review Page (/review/:attemptId) ────────────────────────────────────────

function ReviewPage() {
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
        <div className="flex items-center gap-2 text-text-muted min-w-0">
          <button onClick={() => navigate('/results')} className="hover:text-on-surface transition-colors text-[12px] hidden md:flex items-center gap-1 shrink-0">
            <Icon name="arrow_back" size={16} /> Results
          </button>
          <Icon name="chevron_right" size={16} className="hidden md:block shrink-0" />
          <span className="text-[12px] text-on-surface truncate">{quiz.title}</span>
          <span className="ml-2 px-2 py-0.5 rounded-full bg-surface-bright text-text-muted text-[10px] uppercase tracking-wider shrink-0">Read-only</span>
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

// ─── Settings Page (/settings) ───────────────────────────────────────────────

type SettingsDisplay = {
  LLM_API_STYLE: string;
  LLM_BASE_URL: string;
  LLM_API_KEY_MASKED: string;
  LLM_MODEL: string;
  LLM_MAX_TOKENS: number;
  LLM_TEMPERATURE: number;
  EMBEDDING_API_STYLE: string;
  EMBEDDING_BASE_URL: string;
  EMBEDDING_API_KEY_MASKED: string;
  EMBEDDING_MODEL: string;
  MAX_EMBEDDING_CANDIDATES: number;
  EMBEDDING_BATCH_SIZE: number;
  MAX_RETRIEVED_CHUNKS: number;
  MAX_RETRIEVED_CHARS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  GENERATE_RATE_LIMIT_MAX_REQUESTS: number;
  ENCRYPTION_CONFIGURED: boolean;
};

function SettingsField({
  label, hint, error, children
}: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] font-medium text-on-surface font-geist">{label}</label>
      {children}
      {hint && !error && <p className="text-[11px] text-text-muted">{hint}</p>}
      {error && <p className="text-[11px] text-error">{error}</p>}
    </div>
  );
}

function SettingsInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal transition-colors ${className}`}
    />
  );
}

function SettingsSelect({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`w-full bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2 text-[14px] text-on-surface appearance-none focus:outline-none focus:border-accent-teal transition-colors pr-8 ${className}`}
      />
      <Icon name="expand_more" size={18} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
    </div>
  );
}

function SettingsPage() {
  const navigate = useNavigate();
  const [display, setDisplay] = useState<SettingsDisplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('llm');

  const sections = [
    { id: 'llm', label: 'LLM Provider' },
    { id: 'embedding', label: 'Embedding & Advanced' },
    { id: 'ratelimit', label: 'Rate Limiting' },
    { id: 'security', label: 'Security' },
  ];

  // Track active section via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const visibleRatios: Record<string, number> = {};

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          visibleRatios[id] = entry.intersectionRatio;
          const best = sections.map((s) => s.id).reduce((a, b) =>
            (visibleRatios[a] ?? 0) >= (visibleRatios[b] ?? 0) ? a : b
          );
          setActiveSection(best);
        },
        { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1], rootMargin: '-10% 0px -60% 0px' }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [display]); // re-run when display loads (sections render)

  // Form state
  const [llmApiStyle, setLlmApiStyle] = useState('openai_compatible');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmMaxTokens, setLlmMaxTokens] = useState('');
  const [llmTemperature, setLlmTemperature] = useState('');
  const [embApiStyle, setEmbApiStyle] = useState('same_as_llm');
  const [embBaseUrl, setEmbBaseUrl] = useState('');
  const [embApiKey, setEmbApiKey] = useState('');
  const [embModel, setEmbModel] = useState('');
  const [maxEmbCandidates, setMaxEmbCandidates] = useState('');
  const [embBatchSize, setEmbBatchSize] = useState('');
  const [maxChunks, setMaxChunks] = useState('');
  const [maxChars, setMaxChars] = useState('');
  const [rateLimitMax, setRateLimitMax] = useState('');
  const [generateRateLimitMax, setGenerateRateLimitMax] = useState('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showEmbKey, setShowEmbKey] = useState(false);

  useEffect(() => {
    req<SettingsDisplay>('/api/settings')
      .then((data) => {
        setDisplay(data);
        setLlmApiStyle(data.LLM_API_STYLE);
        setLlmBaseUrl(data.LLM_BASE_URL);
        setLlmModel(data.LLM_MODEL);
        setLlmMaxTokens(String(data.LLM_MAX_TOKENS));
        setLlmTemperature(String(data.LLM_TEMPERATURE));
        setEmbApiStyle(data.EMBEDDING_API_STYLE);
        setEmbBaseUrl(data.EMBEDDING_BASE_URL);
        setEmbModel(data.EMBEDDING_MODEL);
        setMaxEmbCandidates(String(data.MAX_EMBEDDING_CANDIDATES));
        setEmbBatchSize(String(data.EMBEDDING_BATCH_SIZE));
        setMaxChunks(String(data.MAX_RETRIEVED_CHUNKS));
        setMaxChars(String(data.MAX_RETRIEVED_CHARS));
        setRateLimitMax(String(data.RATE_LIMIT_MAX_REQUESTS));
        setGenerateRateLimitMax(String(data.GENERATE_RATE_LIMIT_MAX_REQUESTS));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load settings'));
  }, []);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!llmBaseUrl.trim()) e.llmBaseUrl = 'Required';
    else {
      try { new URL(llmBaseUrl); } catch { e.llmBaseUrl = 'Must be a valid URL'; }
    }
    if (!llmModel.trim()) e.llmModel = 'Required';
    const tokens = Number(llmMaxTokens);
    if (!llmMaxTokens || isNaN(tokens) || tokens < 1 || !Number.isInteger(tokens)) e.llmMaxTokens = 'Must be a positive integer';
    const temp = Number(llmTemperature);
    if (llmTemperature === '' || isNaN(temp) || temp < 0 || temp > 2) e.llmTemperature = 'Must be 0–2';
    const emc = Number(maxEmbCandidates);
    if (!maxEmbCandidates || isNaN(emc) || emc < 20 || emc > 500 || !Number.isInteger(emc)) e.maxEmbCandidates = 'Range: 20–500';
    const ebs = Number(embBatchSize);
    if (!embBatchSize || isNaN(ebs) || ebs < 4 || ebs > 256 || !Number.isInteger(ebs)) e.embBatchSize = 'Range: 4–256';
    const mc = Number(maxChunks);
    if (!maxChunks || isNaN(mc) || mc < 4 || mc > 40 || !Number.isInteger(mc)) e.maxChunks = 'Range: 4–40';
    const mch = Number(maxChars);
    if (!maxChars || isNaN(mch) || mch < 4000 || mch > 120000 || !Number.isInteger(mch)) e.maxChars = 'Range: 4000–120000';
    const rl = Number(rateLimitMax);
    if (!rateLimitMax || isNaN(rl) || rl < 1 || !Number.isInteger(rl)) e.rateLimitMax = 'Must be a positive integer';
    const grl = Number(generateRateLimitMax);
    if (!generateRateLimitMax || isNaN(grl) || grl < 1 || !Number.isInteger(grl)) e.generateRateLimitMax = 'Must be a positive integer';
    return e;
  }

  async function save() {
    const errors = validate();
    setErrs(errors);
    if (Object.keys(errors).length) return;

    setSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      const body: Record<string, unknown> = {
        LLM_API_STYLE: llmApiStyle,
        LLM_BASE_URL: llmBaseUrl.trim(),
        LLM_MODEL: llmModel.trim(),
        LLM_MAX_TOKENS: Number(llmMaxTokens),
        LLM_TEMPERATURE: Number(llmTemperature),
        EMBEDDING_API_STYLE: embApiStyle,
        EMBEDDING_BASE_URL: embBaseUrl.trim() || undefined,
        EMBEDDING_MODEL: embModel.trim() || undefined,
        MAX_EMBEDDING_CANDIDATES: Number(maxEmbCandidates),
        EMBEDDING_BATCH_SIZE: Number(embBatchSize),
        MAX_RETRIEVED_CHUNKS: Number(maxChunks),
        MAX_RETRIEVED_CHARS: Number(maxChars),
        RATE_LIMIT_MAX_REQUESTS: Number(rateLimitMax),
        GENERATE_RATE_LIMIT_MAX_REQUESTS: Number(generateRateLimitMax),
      };
      // Only include keys if user entered new values
      if (llmApiKey.trim()) body.LLM_API_KEY = llmApiKey.trim();
      if (embApiKey.trim()) body.EMBEDDING_API_KEY = embApiKey.trim();

      const updated = await req<SettingsDisplay>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setDisplay(updated);
      setLlmApiKey(''); setEmbApiKey(''); // clear after save
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const section = 'scroll-mt-8';
  const sectionTitle = 'text-[18px] font-medium text-on-surface mb-4 pb-2 border-b border-border-subtle font-geist';
  const card = 'bg-surface-container rounded-lg border border-border-subtle p-6 space-y-6';

  if (loadError) return (
    <div className="flex-1 flex items-center justify-center" style={{ backgroundColor: '#141313' }}>
      <div className="text-center">
        <p className="text-error text-[14px] mb-4">{loadError}</p>
        <button onClick={() => navigate('/')} className="text-[12px] text-text-muted hover:text-on-surface">← Back</button>
      </div>
    </div>
  );

  return (
    <>
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <div>
          <div className="flex items-center gap-1 text-text-muted mb-1">
            <span className="text-[10px] uppercase tracking-wider">App</span>
            <Icon name="chevron_right" size={14} />
            <span className="text-[10px] uppercase tracking-wider text-on-surface">Configuration</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-text-muted hover:text-secondary transition-colors p-1 rounded-full hover:bg-surface-variant hidden md:flex items-center justify-center" title="Go back">
              <Icon name="arrow_back" size={20} />
            </button>
            <h2 className="text-[32px] font-bold text-on-surface font-geist">Settings</h2>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="flex items-center gap-1 text-success text-[12px] font-medium">
              <Icon name="check_circle" size={16} fill className="text-success" /> Saved
            </span>
          )}
          <button
            onClick={() => void save()}
            disabled={saving || !display}
            className="px-4 py-2 bg-secondary text-on-secondary text-[12px] font-bold rounded hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {saving && <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
            Save Changes
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto px-6 py-8">
          {saveError && (
            <div className="mb-6 bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{saveError}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8 items-start">
            {/* In-page nav */}
            <nav className="hidden md:block sticky top-8">
              <ul className="space-y-1">
                {sections.map(({ id, label }) => {
                  const isActive = activeSection === id;
                  return (
                    <li key={id}>
                    <button
                        onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
                        className={`w-full text-left block px-3 py-2 text-[12px] rounded transition-colors font-geist border-l-2 ${
                          isActive
                            ? 'border-secondary bg-surface-container text-on-surface font-medium'
                            : 'border-transparent text-text-muted hover:text-on-surface hover:bg-surface-variant'
                        }`}
                      >
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Forms */}
            <div className="space-y-8 pb-24">
              {/* LLM */}
              <section id="llm" className={section}>
                <h3 className={sectionTitle}>LLM Provider</h3>
                <div className={card}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SettingsField label="API Style" hint="Used for quiz generation.">
                      <SettingsSelect value={llmApiStyle} onChange={(e) => setLlmApiStyle(e.target.value)}>
                        <option value="openai_compatible">OpenAI Compatible (LiteLLM, Ollama…)</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                      </SettingsSelect>
                    </SettingsField>
                    <SettingsField label="Base URL" error={errs.llmBaseUrl} hint="e.g. https://api.openai.com/v1">
                      <SettingsInput value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
                    </SettingsField>
                  </div>

                  <SettingsField
                    label="API Key"
                    hint={display?.LLM_API_KEY_MASKED ? `Current: ${display.LLM_API_KEY_MASKED} — Leave blank to keep.` : 'No key saved yet.'}
                  >
                    <div className="relative">
                      <SettingsInput
                        type={showLlmKey ? 'text' : 'password'}
                        value={llmApiKey}
                        onChange={(e) => setLlmApiKey(e.target.value)}
                        placeholder="Enter new key to update"
                        className="pr-10"
                      />
                      <button type="button" onClick={() => setShowLlmKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-on-surface">
                        <Icon name={showLlmKey ? 'visibility_off' : 'visibility'} size={18} />
                      </button>
                    </div>
                  </SettingsField>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SettingsField label="Model Name *" error={errs.llmModel}>
                      <SettingsInput value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="gpt-4o-mini" />
                    </SettingsField>
                    <SettingsField label="Max Tokens *" error={errs.llmMaxTokens}>
                      <SettingsInput type="number" min={1} value={llmMaxTokens} onChange={(e) => setLlmMaxTokens(e.target.value)} placeholder="2000" />
                    </SettingsField>
                  </div>

                  <SettingsField label={`Temperature: ${llmTemperature}`} error={errs.llmTemperature} hint="0 = precise, 2 = very creative">
                    <input
                      type="range" min={0} max={2} step={0.1}
                      value={llmTemperature}
                      onChange={(e) => setLlmTemperature(e.target.value)}
                      className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-accent-teal"
                    />
                    <div className="flex justify-between text-[11px] text-text-muted mt-1">
                      <span>Precise (0)</span><span>Creative (2)</span>
                    </div>
                  </SettingsField>
                </div>
              </section>

              {/* Embedding & Advanced */}
              <section id="embedding" className={section}>
                <h3 className={sectionTitle}>Embedding & Advanced Config</h3>
                <div className="bg-surface-container rounded-lg border border-border-subtle overflow-hidden">
                  {/* Embedding sub-section */}
                  <div className="p-6 border-b border-border-subtle space-y-6">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Embedding Model</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SettingsField label="API Style">
                        <SettingsSelect value={embApiStyle} onChange={(e) => setEmbApiStyle(e.target.value)}>
                          <option value="same_as_llm">Same as LLM</option>
                          <option value="openai_compatible">OpenAI Compatible</option>
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </SettingsSelect>
                      </SettingsField>
                      <SettingsField label="Model Name">
                        <SettingsInput value={embModel} onChange={(e) => setEmbModel(e.target.value)} placeholder="text-embedding-3-small" />
                      </SettingsField>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SettingsField label="Base URL" hint="Leave blank to inherit from LLM">
                        <SettingsInput value={embBaseUrl} onChange={(e) => setEmbBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
                      </SettingsField>
                      <SettingsField
                        label="API Key"
                        hint={display?.EMBEDDING_API_KEY_MASKED ? `Current: ${display.EMBEDDING_API_KEY_MASKED} — Leave blank to keep.` : 'Leave blank to use LLM key.'}
                      >
                        <div className="relative">
                          <SettingsInput
                            type={showEmbKey ? 'text' : 'password'}
                            value={embApiKey}
                            onChange={(e) => setEmbApiKey(e.target.value)}
                            placeholder="Enter new key to update"
                            className="pr-10"
                          />
                          <button type="button" onClick={() => setShowEmbKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-on-surface">
                            <Icon name={showEmbKey ? 'visibility_off' : 'visibility'} size={18} />
                          </button>
                        </div>
                      </SettingsField>
                    </div>
                  </div>

                  {/* Retrieval params */}
                  <div className="p-6 bg-surface-container-low space-y-6">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Retrieval Parameters</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SettingsField label="Max Embedding Candidates *" error={errs.maxEmbCandidates} hint="Range: 20–500">
                        <SettingsInput type="number" min={20} max={500} value={maxEmbCandidates} onChange={(e) => setMaxEmbCandidates(e.target.value)} />
                      </SettingsField>
                      <SettingsField label="Embedding Batch Size *" error={errs.embBatchSize} hint="Range: 4–256">
                        <SettingsInput type="number" min={4} max={256} value={embBatchSize} onChange={(e) => setEmbBatchSize(e.target.value)} />
                      </SettingsField>
                      <SettingsField label="Max Retrieved Chunks *" error={errs.maxChunks} hint="Range: 4–40">
                        <SettingsInput type="number" min={4} max={40} value={maxChunks} onChange={(e) => setMaxChunks(e.target.value)} />
                      </SettingsField>
                      <SettingsField label="Max Retrieved Chars *" error={errs.maxChars} hint="Range: 4000–120000">
                        <SettingsInput type="number" min={4000} max={120000} value={maxChars} onChange={(e) => setMaxChars(e.target.value)} />
                      </SettingsField>
                    </div>
                  </div>
                </div>
              </section>

              {/* Rate Limiting */}
              <section id="ratelimit" className={section}>
                <h3 className={sectionTitle}>Rate Limiting</h3>
                <div className={card}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SettingsField label="Max Requests / window *" error={errs.rateLimitMax} hint="General API limit per window">
                      <SettingsInput type="number" min={1} value={rateLimitMax} onChange={(e) => setRateLimitMax(e.target.value)} />
                    </SettingsField>
                    <SettingsField label="Generate Max Requests / window *" error={errs.generateRateLimitMax} hint="Limit for quiz generation endpoint (expensive)">
                      <SettingsInput type="number" min={1} value={generateRateLimitMax} onChange={(e) => setGenerateRateLimitMax(e.target.value)} />
                    </SettingsField>
                  </div>
                </div>
              </section>

              {/* Security — status only, key managed via env */}
              <section id="security" className={section}>
                <h3 className={sectionTitle}>Security</h3>
                <div className={card}>
                  <div className="flex items-start gap-3 p-3 bg-surface-container-low rounded border border-border-subtle">
                    <Icon name={display?.ENCRYPTION_CONFIGURED ? 'lock' : 'lock_open'} size={20} className={display?.ENCRYPTION_CONFIGURED ? 'text-success shrink-0 mt-0.5' : 'text-yellow-400 shrink-0 mt-0.5'} />
                    <div>
                      <p className="text-[13px] text-on-surface font-medium">
                        {display?.ENCRYPTION_CONFIGURED ? 'Secret encryption active' : 'Encryption not configured'}
                      </p>
                      <p className="text-[12px] text-text-muted mt-0.5">
                        {display?.ENCRYPTION_CONFIGURED
                          ? 'API keys are stored encrypted in the database using AES-256-GCM.'
                          : 'Set SETTINGS_ENCRYPTION_KEY in the server .env to enable encrypted storage. Generate with: openssl rand -hex 32'}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function App() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);

  async function reload() {
    const data = await req<Quiz[]>('/api/quizzes');
    setQuizzes(data);
  }

  useEffect(() => { void reload(); }, []);

  return (
    <QuizzesContext.Provider value={{ quizzes, reload }}>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<CreateQuizPage />} />
            <Route path="/quiz/:id" element={<QuizPage />} />
            <Route path="/review/:attemptId" element={<ReviewPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QuizzesContext.Provider>
  );
}
