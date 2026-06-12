import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { DifficultyControl } from './DifficultyControl';
import { QuestionTypeSelect } from './QuestionTypeSelect';
import { req } from '../api';
import type {
  GenerationJob,
  GroupQuizGenerationResult,
  JobCreatedResponse,
  Quiz,
  QuizGroup,
  QuizSettings
} from '../types';
import { defaultSettings } from '../helpers';

export function useGenerationJob<T>(jobId: string | null) {
  const [job, setJob] = useState<GenerationJob<T> | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      setPollError(null);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const nextJob = await req<GenerationJob<T>>(`/api/jobs/${jobId}`);
        if (cancelled) return;
        setJob(nextJob);
        setPollError(null);
        if (nextJob.status === 'queued' || nextJob.status === 'running') {
          timer = window.setTimeout(poll, 1000);
        }
      } catch (error) {
        if (cancelled) return;
        setPollError(error instanceof Error ? error.message : 'Failed to fetch job status');
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [jobId]);

  return { job, pollError };
}

export function GenerationStatusPanel({ job, pollError, idleLabel, successLabel }: {
  job: GenerationJob<unknown> | null;
  pollError: string | null;
  idleLabel: string;
  successLabel?: string;
}) {
  if (!job && !pollError) {
    return null;
  }

  const stepTotal = Math.max(job?.stepTotal ?? 1, 1);
  const stepIndex = Math.min(job?.stepIndex ?? 1, stepTotal);
  const milestonePercent = job ? Math.max(8, Math.round((stepIndex / stepTotal) * 100)) : 0;
  const countPercent = job?.totalCount && job.totalCount > 0 && job.doneCount !== null
    ? Math.round((job.doneCount / job.totalCount) * 100)
    : null;
  const progressPercent = countPercent !== null ? Math.max(milestonePercent, countPercent) : milestonePercent;
  const failed = Boolean(pollError) || job?.status === 'failed';
  const completed = job?.status === 'completed';
  const badgeClass = failed
    ? 'bg-error-container text-on-error-container border-error/30'
    : completed
      ? 'bg-success/10 text-success border-success/30'
      : 'bg-surface text-text-muted border-border-subtle';
  const barClass = failed ? 'bg-error' : completed ? 'bg-success' : 'bg-secondary';
  const statusLabel = failed
    ? 'Failed'
    : completed
      ? (successLabel ?? 'Completed')
      : job?.status === 'queued'
        ? 'Queued'
        : job?.status === 'running'
          ? 'Running'
          : idleLabel;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-container p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.18em] text-text-muted">Generation Status</p>
          <h3 className="text-[16px] font-semibold text-on-surface font-geist">
            {failed ? (pollError ?? job?.error ?? 'Generation failed') : (job?.currentStep ?? idleLabel)}
          </h3>
          {job?.message && !failed && <p className="text-[12px] text-text-muted mt-1">{job.message}</p>}
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeClass}`}>
          {statusLabel}
        </span>
      </div>

      {job && (
        <>
          <div className="flex items-center justify-between text-[12px] text-text-muted">
            <span>Step {stepIndex} / {stepTotal}</span>
            {job && job.totalCount !== null && job.doneCount !== null && (
              <span>{job.doneCount} / {job.totalCount} quizzes</span>
            )}
          </div>
          <div className="h-2 rounded-full bg-surface-variant overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${barClass}`}
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function GenerationProgressDialog({ job, pollError, open, title }: {
  job: GenerationJob<unknown> | null;
  pollError: string | null;
  open: boolean;
  title: string;
}) {
  if (!open) {
    return null;
  }

  const stepTotal = Math.max(job?.stepTotal ?? 6, 1);
  const stepIndex = Math.min(job?.stepIndex ?? 1, stepTotal);
  const visibleSteps = Array.from({ length: stepTotal }, (_, index) => {
    const number = index + 1;
    if (job?.currentStep && number === stepIndex) {
      return job.currentStep;
    }

    switch (number) {
      case 1:
        return 'Validating request';
      case 2:
        return 'Preparing sources';
      case 3:
        return 'Retrieving context';
      case 4:
        return 'Calling model';
      case 5:
        return 'Validating output';
      case 6:
        return 'Saving result';
      default:
        return `Step ${number}`;
    }
  });
  const failed = Boolean(pollError) || job?.status === 'failed';
  const completed = job?.status === 'completed';
  const currentLabel = failed
    ? (pollError ?? job?.error ?? 'Generation failed')
    : completed
      ? 'Completed'
      : (job?.currentStep ?? 'Starting job');
  const previousStep = stepIndex > 1 ? visibleSteps[stepIndex - 2] : null;
  const currentStep = visibleSteps[stepIndex - 1] ?? currentLabel;
  const nextStep = stepIndex < stepTotal ? visibleSteps[stepIndex] : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-[min(92vw,420px)] px-6 py-5">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-3 text-on-surface">
            {failed ? (
              <div className="w-10 h-10 rounded-full bg-error/15 flex items-center justify-center">
                <Icon name="close" size={20} className="text-error" />
              </div>
            ) : completed ? (
              <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center">
                <Icon name="check" size={20} className="text-success" />
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-secondary/15 flex items-center justify-center">
                <svg className="animate-spin w-5 h-5 text-secondary" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
            <div className="text-left">
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{title}</p>
              <p className="text-[20px] font-semibold font-geist text-on-surface">{currentStep}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full max-w-[320px]">
            {previousStep && (
              <div className="text-[13px] text-white/70">
                <span className="text-success mr-2">Done</span>
                {previousStep}
              </div>
            )}

            {job?.message && !failed && (
              <div className="text-[12px] text-text-muted">{job.message}</div>
            )}

            {nextStep && !failed && !completed && (
              <div className="text-[13px] text-white/55">
                <span className="text-text-muted mr-2">Next</span>
                {nextStep}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-[12px] text-text-muted">
            <span>Step {stepIndex} / {stepTotal}</span>
            {job && job.totalCount !== null && job.doneCount !== null && (
              <span>{job.doneCount} / {job.totalCount}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RegenerateDialog({ quiz, group, quizzes, onClose, onComplete }: {
  quiz?: Quiz;
  group?: QuizGroup;
  quizzes?: Quiz[];
  onClose: () => void;
  onComplete: (result?: Quiz | GroupQuizGenerationResult) => void;
}) {
  const isGroup = Boolean(group);
  const initialSettings = quiz?.settings ?? quizzes?.[0]?.settings ?? defaultSettings;

  const [settings, setSettings] = useState<QuizSettings>(initialSettings);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'overwrite' | 'duplicate'>('overwrite');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job, pollError } = useGenerationJob<Quiz | GroupQuizGenerationResult>(jobId);
  const completionHandledRef = useRef(false);
  const regenerateLabel = job
    ? job.totalCount !== null && job.doneCount !== null
      ? `${job.currentStep} (${job.doneCount}/${job.totalCount})`
      : job.currentStep
    : 'Regenerate';

  useEffect(() => {
    if (!job) return;
    if (job.status === 'completed') {
      if (completionHandledRef.current) return;
      completionHandledRef.current = true;
      setLoading(false);
      onClose();
      onComplete(job.resultPayload ?? undefined);
    } else if (job.status === 'failed') {
      setLoading(false);
      setError(job.error ?? 'Regeneration failed');
    }
  }, [job, onComplete]);

  async function regenerate() {
    setLoading(true);
    setError(null);
    completionHandledRef.current = false;

    try {
      if (settings.questionType.includes('true_false') && settings.questionType.length === 1 && settings.choicesPerQuestion !== 2) {
        throw new Error('True/False requires 2 choices');
      }
      if (settings.questionType.includes('multi_select') && settings.questionType.length === 1 && settings.choicesPerQuestion < 4) {
        throw new Error('Multi Select requires at least 4 choices');
      }
      if (quiz && !isGroup) {
        const response = await req<JobCreatedResponse>(`/api/jobs/quizzes/${quiz.id}/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings, prompt: prompt.trim() || undefined, mode }),
        });
        setJobId(response.jobId);
      } else if (group && quizzes) {
        const response = await req<JobCreatedResponse>(`/api/jobs/groups/${group.id}/regenerate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings, prompt: prompt.trim() || undefined, mode }),
        });
        setJobId(response.jobId);
      }
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : 'Regeneration failed');
    }
  }

  const title = isGroup ? `Regenerate Group: ${group!.name}` : `Regenerate: ${quiz!.title}`;
  const quizCount = isGroup ? quizzes?.length ?? 0 : 1;
  const showProgressOverlay = loading || job?.status === 'queued' || job?.status === 'running';

  if (job?.status === 'completed') {
    return null;
  }

  if (showProgressOverlay) {
    return (
      <GenerationProgressDialog
        job={job}
        pollError={pollError}
        open={showProgressOverlay}
        title={title}
      />
    );
  }

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

            <DifficultyControl
              id="regenerate-difficulty"
              value={settings.difficulty}
              onChange={(difficulty) => setSettings({ ...settings, difficulty })}
            />

            <QuestionTypeSelect
              value={settings.questionType}
              onChange={(questionType) => setSettings({
                ...settings,
                questionType,
                choicesPerQuestion: questionType.includes('true_false') && questionType.length === 1
                  ? 2
                  : questionType.includes('multi_select') && questionType.length === 1
                    ? Math.max(4, settings.choicesPerQuestion)
                    : settings.choicesPerQuestion
              })}
            />

            {!(settings.questionType.length === 1 && (settings.questionType[0] === 'true_false' || settings.questionType[0] === 'free_text')) && (
              <div className="space-y-2">
                <label className="text-[12px] font-medium text-on-surface block font-geist">Choices per Question</label>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSettings({ ...settings, choicesPerQuestion: Math.max(settings.questionType.includes('multi_select') && settings.questionType.length === 1 ? 4 : 2, settings.choicesPerQuestion - 1) })} className="w-8 h-8 rounded border border-border-subtle flex items-center justify-center text-text-muted hover:border-outline-variant">-</button>
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

        {(error || pollError) && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[13px] text-on-error-container">{error ?? pollError}</div>}

        <GenerationStatusPanel
          job={job}
          pollError={pollError}
          idleLabel="Ready to regenerate"
          successLabel="Completed"
        />

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => void regenerate()}
            disabled={loading}
            className="px-4 py-2 bg-secondary hover:opacity-90 disabled:opacity-50 text-on-secondary-fixed rounded text-[12px] font-medium transition-colors flex items-center gap-2"
          >
            {loading && !jobId && (
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            <Icon name="autorenew" size={16} />
            {loading ? regenerateLabel : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}
