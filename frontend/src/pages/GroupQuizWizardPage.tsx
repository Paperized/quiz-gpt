import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { req } from '../api';
import { useQuizzes } from '../context';
import { defaultSettings, getSidebarCollapsedState, setSidebarCollapsedState } from '../helpers';
import { Icon } from '../components/Icon';
import { DifficultyControl } from '../components/DifficultyControl';
import { QuestionTypeSelect } from '../components/QuestionTypeSelect';
import { GenerationProgressDialog, GenerationStatusPanel, useGenerationJob } from '../components/RegenerateDialog';
import type {
  GroupQuizGenerationResult,
  GroupQuizProposal,
  GroupQuizProposalItem,
  JobCreatedResponse,
  Model,
  QuizSettings
} from '../types';

function isValidItem(item: GroupQuizProposalItem) {
  return item.title.trim().length > 0 && item.focus.trim().length > 0;
}

export function GroupQuizWizardPage() {
  const navigate = useNavigate();
  const { reload, reloadGroups } = useQuizzes();
  const [topic, setTopic] = useState('');
  const [settings, setSettings] = useState<QuizSettings>(defaultSettings);
  const [sourceText, setSourceText] = useState('');
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [documents, setDocuments] = useState<File[]>([]);
  const [minQuizCount, setMinQuizCount] = useState(1);
  const [maxQuizCount, setMaxQuizCount] = useState(4);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<GroupQuizProposal | null>(null);
  const [result, setResult] = useState<GroupQuizGenerationResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobAction, setJobAction] = useState<'proposal' | 'generation' | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [llmModelId, setLlmModelId] = useState<string>('');
  const [embeddingModelId, setEmbeddingModelId] = useState<string>('');
  const { job, pollError } = useGenerationJob<GroupQuizProposal | GroupQuizGenerationResult>(jobId);

  useEffect(() => {
    req<Model[]>('/api/models')
      .then((data) => {
        setModels(data);
        const defaultLlm = data.find((m) => m.modelType === 'llm' && m.isDefault);
        if (defaultLlm) setLlmModelId(defaultLlm.id);
        const defaultEmb = data.find((m) => m.modelType === 'embedding' && m.isDefault);
        if (defaultEmb) setEmbeddingModelId(defaultEmb.id);
      })
      .catch(() => {});
  }, []);
  const proposalLabel = jobAction === 'proposal' && job
    ? job.totalCount !== null && job.doneCount !== null
      ? `${job.currentStep} (${job.doneCount}/${job.totalCount})`
      : job.currentStep
    : 'Proposing group...';
  const generationLabel = jobAction === 'generation' && job
    ? job.totalCount !== null && job.doneCount !== null
      ? `${job.currentStep} (${job.doneCount}/${job.totalCount})`
      : job.currentStep
    : 'Generating group...';
  const showProgressOverlay =
    proposalLoading ||
    generationLoading ||
    job?.status === 'queued' ||
    job?.status === 'running';
  const progressTitle = jobAction === 'proposal' ? 'Proposing Group Quiz' : 'Generating Group Quiz';

  const validItems = useMemo(() => proposal?.items.filter(isValidItem) ?? [], [proposal]);
  const isPhaseTwo = proposal !== null;

  useEffect(() => {
    if (!job || !jobAction || !jobId || job.id !== jobId) return;
    if (job.status === 'failed') {
      setProposalLoading(false);
      setGenerationLoading(false);
      setError(job.error ?? (jobAction === 'proposal' ? 'Failed to propose group quiz' : 'Failed to generate group quiz'));
      return;
    }
    if (job.status !== 'completed' || !job.resultPayload) return;

    if (jobAction === 'proposal') {
      setProposal(job.resultPayload as GroupQuizProposal);
      setProposalLoading(false);
      return;
    }

    const generationResult = job.resultPayload as GroupQuizGenerationResult;
    setGenerationLoading(false);
    setResult(generationResult);
    void (async () => {
      await reloadGroups();
      await reload();
      setSidebarCollapsedState({
        ...getSidebarCollapsedState(),
        __groups__: false,
        [generationResult.groupId]: false
      });
      if (generationResult.quizzes[0]) {
        navigate(`/quiz/${generationResult.quizzes[0].id}`);
      }
    })();
  }, [job, jobAction, jobId, navigate, reload, reloadGroups]);

  function validateSettings() {
    if (settings.questionType.includes('true_false') && settings.questionType.length === 1 && settings.choicesPerQuestion !== 2) {
      setError('True/False requires 2 choices');
      return false;
    }
    if (settings.questionType.includes('multi_select') && settings.questionType.length === 1 && settings.choicesPerQuestion < 4) {
      setError('Multi Select requires at least 4 choices');
      return false;
    }
    if (minQuizCount > maxQuizCount) {
      setError('Minimum quiz count cannot be greater than maximum quiz count');
      return false;
    }
    return true;
  }

  function appendSourceFormData(form: FormData) {
    form.append('topic', topic);
    form.append('settings', JSON.stringify(settings));
    if (llmModelId) form.append('llmModelId', llmModelId);
    form.append('embeddingModelId', embeddingModelId || '');
    if (sourceText.trim()) form.append('sourceText', sourceText.trim());
    if (githubRepoUrl.trim()) form.append('githubRepoUrl', githubRepoUrl.trim());
    for (const file of documents) form.append('documents', file);
  }

  async function proposeGroupQuiz() {
    if (!validateSettings() || !topic.trim()) return;

    setProposalLoading(true);
    setError(null);
    setResult(null);
    setJobId(null);
    try {
      const form = new FormData();
      appendSourceFormData(form);
      form.append('minQuizCount', String(minQuizCount));
      form.append('maxQuizCount', String(maxQuizCount));
      setJobAction('proposal');
      const response = await req<JobCreatedResponse>('/api/jobs/group-quizzes/propose', {
        method: 'POST',
        body: form
      });
      setJobId(response.jobId);
    } catch (e) {
      setProposalLoading(false);
      setError(e instanceof Error ? e.message : 'Failed to propose group quiz');
    }
  }

  function updateItem(index: number, field: keyof GroupQuizProposalItem, value: string) {
    setProposal((current) => {
      if (!current) return current;
      const items = current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item);
      return { ...current, items };
    });
  }

  function deleteItem(index: number) {
    setProposal((current) => current ? { ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) } : current);
  }

  function addItem() {
    setProposal((current) => ({
      groupTitle: current?.groupTitle ?? `${topic.trim() || 'New'} Group Quiz`,
      items: [...(current?.items ?? []), { title: '', focus: '' }]
    }));
  }

  async function generateGroupQuiz() {
    if (!proposal) {
      setError('Create a proposal before generating the group');
      return;
    }
    if (!validateSettings()) return;
    if (validItems.length === 0) {
      setError('Keep at least one item with both title and focus');
      return;
    }

    setGenerationLoading(true);
    setError(null);
    setResult(null);
    setJobId(null);
    try {
      const form = new FormData();
      appendSourceFormData(form);
      form.append('groupTitle', proposal.groupTitle.trim());
      form.append('items', JSON.stringify(validItems.map((item) => ({
        title: item.title.trim(),
        focus: item.focus.trim()
      }))));

      setJobAction('generation');
      const response = await req<JobCreatedResponse>('/api/jobs/group-quizzes/generate', {
        method: 'POST',
        body: form
      });
      setJobId(response.jobId);
    } catch (e) {
      setGenerationLoading(false);
      setError(e instanceof Error ? e.message : 'Failed to generate group quiz');
    }
  }

  function backToPhaseOne() {
    setError(null);
    setResult(null);
    setProposal(null);
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: '#141313' }}>
      <div className="max-w-[1200px] mx-auto px-6 py-12">
        <div className="mb-8">
          <h2 className="text-[32px] font-bold text-on-surface mb-2 font-geist">New Group Quiz</h2>
          <p className="text-[16px] text-text-muted">
            {isPhaseTwo
              ? 'Review and refine the proposed quiz group before generating it.'
              : 'Create a group-specific source prompt and define the quiz-count range for the proposal.'}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {!isPhaseTwo ? (
            <>
              <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-4">
                <div className="bg-surface-container rounded-xl border border-border-subtle overflow-hidden focus-within:border-secondary transition-colors shadow-sm">
                  <div className="p-4 border-b border-border-subtle bg-surface-container-low flex justify-between items-center">
                    <label className="text-[12px] font-medium text-on-surface flex items-center gap-2 font-geist" htmlFor="group-quiz-topic">
                      <Icon name="edit_note" size={16} className="text-text-muted" />
                      Group Topic or Instruction
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-muted font-geist">Model</span>
                      <select
                        className="bg-surface border border-border-subtle text-on-surface text-[12px] rounded focus:border-secondary focus:ring-0 py-1.5 px-2"
                        value={llmModelId}
                        onChange={(e) => setLlmModelId(e.target.value)}
                      >
                        {models.filter((m) => m.modelType === 'llm').length === 0
                          ? <option disabled value="">No models configured</option>
                          : models.filter((m) => m.modelType === 'llm').map((m) => (
                            <option key={m.id} value={m.id}>{m.label}{m.isSystem ? ' (system)' : ''}</option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <textarea
                    id="group-quiz-topic"
                    className="w-full bg-transparent border-none text-[16px] text-on-surface placeholder:text-on-primary-container focus:ring-0 p-6 resize-none"
                    placeholder="e.g., Build a group of quizzes covering the main architectural areas of this codebase..."
                    rows={6}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                  />
                </div>

                <div className="bg-surface border border-border-subtle rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-border-subtle bg-surface-container-low flex justify-between items-center">
                    <h3 className="text-[12px] font-medium text-on-surface flex items-center gap-2 font-geist">
                      <Icon name="library_add" size={16} className="text-text-muted" />
                      Additional Context Sources (Optional)
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-text-muted font-geist">Embedding</span>
                      <select
                        className="bg-surface border border-border-subtle text-on-surface text-[12px] rounded focus:border-secondary focus:ring-0 py-1.5 px-2"
                        value={embeddingModelId}
                        onChange={(e) => setEmbeddingModelId(e.target.value)}
                      >
                        <option value="">None (lexical)</option>
                        {models.filter((m) => m.modelType === 'embedding').length === 0
                          ? <option disabled value="">No models configured</option>
                          : models.filter((m) => m.modelType === 'embedding').map((m) => (
                            <option key={m.id} value={m.id}>{m.label}{m.isSystem ? ' (system)' : ''}</option>
                          ))}
                      </select>
                    </div>
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
                      placeholder="Paste notes, documentation, or any text to ground the group proposal..."
                      rows={3}
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-4 items-stretch">
                <div className="bg-surface-container rounded-xl border border-border-subtle p-6 flex flex-col gap-6">
                  <div className="flex items-center gap-2">
                    <Icon name="settings_suggest" size={20} className="text-secondary" />
                    <h3 className="text-[18px] font-medium text-on-surface font-geist">Phase 1: Proposal Setup</h3>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <label className="text-[12px] font-medium text-on-surface font-geist">Number of Questions</label>
                      <span className="text-[12px] font-medium text-secondary">{settings.numQuestions}</span>
                    </div>
                    <input
                      className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-accent-teal"
                      max={40}
                      min={1}
                      type="range"
                      value={settings.numQuestions}
                      onChange={(e) => setSettings({ ...settings, numQuestions: +e.target.value })}
                    />
                    <div className="flex justify-between text-[12px] text-text-muted opacity-50"><span>1</span><span>40</span></div>
                  </div>

                  <DifficultyControl
                    id="group-difficulty"
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

                  <div className="border-t border-border-subtle pt-6 space-y-4">
                    <div>
                      <h4 className="text-[14px] font-medium text-on-surface font-geist mb-1">Group Proposal Range</h4>
                      <p className="text-[12px] text-text-muted">Let the model decide how many quiz topics are worth creating within this range.</p>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[12px] font-medium text-on-surface font-geist">Minimum quiz topics</label>
                        <span className="text-[12px] font-medium text-secondary">{minQuizCount}</span>
                      </div>
                      <input
                        className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-accent-teal"
                        min={1}
                        max={8}
                        type="range"
                        value={minQuizCount}
                        onChange={(e) => setMinQuizCount(Number(e.target.value))}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[12px] font-medium text-on-surface font-geist">Maximum quiz topics</label>
                        <span className="text-[12px] font-medium text-secondary">{maxQuizCount}</span>
                      </div>
                      <input
                        className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-accent-teal"
                        min={1}
                        max={8}
                        type="range"
                        value={maxQuizCount}
                        onChange={(e) => setMaxQuizCount(Number(e.target.value))}
                      />
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>
                )}

                <GenerationStatusPanel
                  job={job}
                  pollError={pollError}
                  idleLabel="Ready to propose"
                  successLabel="Proposal ready"
                />

                <button
                  disabled={proposalLoading || generationLoading || !topic.trim()}
                  onClick={() => void proposeGroupQuiz()}
                  className="w-full min-h-[64px] bg-secondary hover:opacity-90 disabled:opacity-60 text-on-secondary-fixed px-6 py-4 rounded-xl text-[18px] font-bold flex items-center justify-center gap-3 text-center transition-all shadow-lg"
                >
                  {proposalLoading ? (
                    <>
                      <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {proposalLabel}
                    </>
                  ) : (
                    <>
                      <Icon name="psychology" size={24} />
                      Propose Group Quiz
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="lg:col-span-8 flex flex-col gap-4">
                <div className="bg-surface-container rounded-xl border border-border-subtle p-6 flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-[18px] font-medium text-on-surface font-geist">Phase 2: Review and Edit</h3>
                      <p className="text-[13px] text-text-muted">Review the proposed group title and refine each quiz topic before generation.</p>
                    </div>
                    <button
                      onClick={addItem}
                      className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-[13px] text-on-surface hover:border-outline-variant"
                    >
                      <Icon name="add" size={18} />
                      Add new item
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[12px] font-medium text-on-surface font-geist">Group title</label>
                    <input
                      className="w-full rounded-lg border border-border-subtle bg-surface px-4 py-3 text-[15px] text-on-surface focus:border-secondary focus:outline-none"
                      value={proposal.groupTitle}
                      onChange={(e) => setProposal({ ...proposal, groupTitle: e.target.value })}
                    />
                  </div>

                  <div className="flex flex-col gap-4">
                    {proposal.items.map((item, index) => (
                      <div key={index} className="rounded-xl border border-border-subtle bg-surface p-4 flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[12px] font-medium text-text-muted uppercase tracking-[0.15em]">Item {index + 1}</span>
                          <button onClick={() => deleteItem(index)} className="inline-flex items-center gap-1 text-[12px] text-error">
                            <Icon name="delete" size={16} />
                            Delete
                          </button>
                        </div>
                        <div className="space-y-2">
                          <label className="block text-[12px] font-medium text-on-surface font-geist">Quiz title</label>
                          <input
                            className="w-full rounded-lg border border-border-subtle bg-surface-container px-4 py-3 text-[14px] text-on-surface focus:border-secondary focus:outline-none"
                            value={item.title}
                            onChange={(e) => updateItem(index, 'title', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="block text-[12px] font-medium text-on-surface font-geist">Focus</label>
                          <textarea
                            className="w-full rounded-lg border border-border-subtle bg-surface-container px-4 py-3 text-[14px] text-on-surface focus:border-secondary focus:outline-none resize-none"
                            rows={3}
                            value={item.focus}
                            onChange={(e) => updateItem(index, 'focus', e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {result && (
                  <div className="bg-surface-container rounded-xl border border-border-subtle p-6 flex flex-col gap-3">
                    <h3 className="text-[18px] font-medium text-on-surface font-geist">Generation Summary</h3>
                    <p className="text-[14px] text-text-muted">
                      Created {result.quizzes.length} quiz{result.quizzes.length === 1 ? '' : 'zes'}
                      {result.errors.length > 0 ? ` with ${result.errors.length} partial failure${result.errors.length === 1 ? '' : 's'}` : ''}.
                    </p>
                    {result.errors.length > 0 && (
                      <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[13px] text-text-muted">
                        {result.errors.map((entry) => (
                          <div key={`${entry.itemTitle}:${entry.message}`}>
                            <span className="text-on-surface">{entry.itemTitle}</span>: {entry.message}
                          </div>
                        ))}
                      </div>
                    )}
                    {result.quizzes[0] && (
                      <button
                        onClick={() => navigate(`/quiz/${result.quizzes[0].id}`)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent-teal px-4 py-3 text-[14px] font-bold text-white"
                      >
                        <Icon name="open_in_new" size={18} />
                        Open First Quiz
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="lg:col-span-4 flex flex-col gap-4">
                <div className="bg-surface-container rounded-xl border border-border-subtle p-6 flex flex-col gap-4">
                  <div>
                    <h3 className="text-[18px] font-medium text-on-surface font-geist mb-1">Phase 2 Actions</h3>
                    <p className="text-[13px] text-text-muted">Generate the group once at least one valid item remains.</p>
                  </div>
                  <button
                    onClick={() => void proposeGroupQuiz()}
                    disabled={proposalLoading || generationLoading || !topic.trim()}
                    className="w-full rounded-lg border border-border-subtle px-4 py-3 text-[14px] font-medium text-on-surface hover:border-outline-variant disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {proposalLoading ? (
                      <>
                        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {proposalLabel}
                      </>
                    ) : (
                      <>
                        <Icon name="refresh" size={18} />
                        Refresh Proposal
                      </>
                    )}
                  </button>
                  <button
                    onClick={backToPhaseOne}
                    disabled={proposalLoading || generationLoading}
                    className="w-full rounded-lg border border-border-subtle px-4 py-3 text-[14px] font-medium text-on-surface hover:border-outline-variant disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    <Icon name="arrow_back" size={18} />
                    Back to Phase 1
                  </button>
                  <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3 text-[13px] text-text-muted">
                    {validItems.length > 0
                      ? `${validItems.length} valid item${validItems.length === 1 ? '' : 's'} ready for generation`
                      : 'At least one item with title and focus is required'}
                  </div>
                </div>

                {error && (
                  <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>
                )}

                <GenerationStatusPanel
                  job={job}
                  pollError={pollError}
                  idleLabel="Ready to generate"
                  successLabel="Group created"
                />

                <button
                  disabled={generationLoading || validItems.length === 0}
                  onClick={() => void generateGroupQuiz()}
                  className="w-full bg-accent-teal hover:opacity-90 disabled:opacity-60 text-white py-4 rounded-xl text-[18px] font-bold flex items-center justify-center gap-3 transition-all shadow-lg"
                >
                  {generationLoading ? (
                    <>
                      <svg className="animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {generationLabel}
                    </>
                  ) : (
                    <>
                      <Icon name="library_add_check" size={24} />
                      Generate Group Quiz
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mt-16 text-center opacity-40">
          <p className="text-[12px] text-text-muted">Powered by AI · Review outputs before sharing</p>
        </div>
      </div>
      <GenerationProgressDialog
        job={job}
        pollError={pollError}
        open={showProgressOverlay}
        title={progressTitle}
      />
    </div>
  );
}
