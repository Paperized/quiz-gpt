import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useQuizzes } from '../context';
import { req } from '../api';
import { defaultSettings } from '../helpers';
import type { Quiz, QuizSettings } from '../types';

// ─── Create Quiz Page ('/') ────────────────────────────────────────────────────

export function CreateQuizPage() {
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
