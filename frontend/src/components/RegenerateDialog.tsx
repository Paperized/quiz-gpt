import { useState } from 'react';
import { Icon } from './Icon';
import { req } from '../api';
import type { Quiz, QuizSettings, QuizGroup } from '../types';

const defaultSettings: QuizSettings = {
  numQuestions: 10,
  choicesPerQuestion: 4,
  difficulty: 'Medium',
  language: 'English',
  questionType: 'mixed',
};

export function RegenerateDialog({ quiz, group, quizzes, onClose, onComplete }: {
  quiz?: Quiz;
  group?: QuizGroup;
  quizzes?: Quiz[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const isGroup = Boolean(group);
  const initialSettings = quiz?.settings ?? quizzes?.[0]?.settings ?? defaultSettings;

  const [settings, setSettings] = useState<QuizSettings>(initialSettings);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'overwrite' | 'duplicate'>('overwrite');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function regenerate() {
    setLoading(true);
    setError(null);

    try {
      if (quiz && !isGroup) {
        await req(`/api/quizzes/${quiz.id}/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings, prompt: prompt.trim() || undefined, mode }),
        });
      } else if (group && quizzes) {
        setProgress({ done: 0, total: quizzes.length });
        const res = await req<{ groupId: string; quizzes: Quiz[]; errors: string[] }>(`/api/groups/${group.id}/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings, prompt: prompt.trim() || undefined, mode }),
        });
        setProgress({ done: res.quizzes.length, total: quizzes.length });
        if (res.errors.length > 0) {
          setError(`${res.errors.length} quiz failed: ${res.errors[0]}`);
        }
      }
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Regeneration failed');
    } finally {
      setLoading(false);
    }
  }

  const title = isGroup ? `Regenerate Group: ${group!.name}` : `Regenerate: ${quiz!.title}`;
  const quizCount = isGroup ? quizzes?.length ?? 0 : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full md:max-w-lg bg-surface-container rounded-t-2xl md:rounded-2xl border border-border-subtle shadow-2xl p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="autorenew" size={20} className="text-secondary" />
            <h2 className="text-[16px] font-semibold text-on-surface font-geist">{title}</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface transition-colors">
            <Icon name="close" size={20} />
          </button>
        </div>

        {isGroup && (
          <p className="text-[12px] text-text-muted">
            This will regenerate <span className="text-on-surface font-medium">{quizCount} quiz{quizCount !== 1 ? 'zes' : ''}</span> in parallel. Each quiz keeps its original topic.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {/* Settings */}
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

          {/* Optional prompt */}
          <div className="space-y-1.5">
            <label className="block text-[12px] font-medium text-on-surface font-geist">
              Additional Instruction <span className="text-text-muted font-normal">(optional)</span>
            </label>
            <textarea
              className="w-full bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal transition-colors resize-none"
              placeholder={isGroup
                ? 'e.g. Focus on advanced topics, remove questions about deprecated features...'
                : 'e.g. Make questions harder, focus on edge cases, add more practical scenarios...'}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            {isGroup && (
              <p className="text-[11px] text-text-muted">
                Applied to each quiz. The LLM will incorporate it only if relevant to the quiz topic.
              </p>
            )}
          </div>

          {/* Mode */}
          <div className="space-y-2">
            <label className="block text-[12px] font-medium text-on-surface font-geist">Mode</label>
            <div className="flex flex-col gap-2">
              <label className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors ${mode === 'overwrite' ? 'border-secondary bg-secondary/10' : 'border-border-subtle hover:border-outline-variant'}`}>
                <input type="radio" name="mode" checked={mode === 'overwrite'} onChange={() => setMode('overwrite')} className="accent-accent-teal" />
                <div>
                  <span className="text-[13px] text-on-surface font-medium">Overwrite</span>
                  <p className="text-[11px] text-text-muted">
                    {isGroup ? 'Replace questions in existing quizzes' : 'Replace questions in this quiz'}
                  </p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors ${mode === 'duplicate' ? 'border-secondary bg-secondary/10' : 'border-border-subtle hover:border-outline-variant'}`}>
                <input type="radio" name="mode" checked={mode === 'duplicate'} onChange={() => setMode('duplicate')} className="accent-accent-teal" />
                <div>
                  <span className="text-[13px] text-on-surface font-medium">Duplicate</span>
                  <p className="text-[11px] text-text-muted">
                    {isGroup ? 'Create new group "' + group!.name + ' Regen" with new quizzes' : 'Create a new quiz (same group if grouped)'}
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {error && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[13px] text-on-error-container">{error}</div>}

        {progress && (
          <div className="flex items-center gap-2 text-[12px] text-text-muted">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Regenerating {progress.done}/{progress.total}...
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => void regenerate()}
            disabled={loading}
            className="px-4 py-2 bg-secondary hover:opacity-90 disabled:opacity-50 text-on-secondary-fixed rounded text-[12px] font-medium transition-colors flex items-center gap-2"
          >
            {loading && !progress && (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <Icon name="autorenew" size={16} />
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}
