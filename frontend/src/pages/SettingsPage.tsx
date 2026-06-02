import { useEffect, useReducer, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { req } from '../api';
import type { SettingsDisplay } from '../types';

// ─── Settings Page (/settings) ───────────────────────────────────────────────

// Form state
type SettingsFormState = {
  llmApiStyle: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmMaxTokens: string;
  llmTemperature: string;
  embApiStyle: string;
  embBaseUrl: string;
  embApiKey: string;
  embModel: string;
  maxEmbCandidates: string;
  embBatchSize: string;
  maxChunks: string;
  maxChars: string;
  rateLimitMax: string;
  generateRateLimitMax: string;
};

type SettingsAction =
  | { type: 'SET_FIELD'; field: keyof SettingsFormState; value: string }
  | { type: 'LOAD'; display: SettingsDisplay }
  | { type: 'CLEAR_KEYS' };

const initialFormState: SettingsFormState = {
  llmApiStyle: 'openai_compatible',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  llmMaxTokens: '',
  llmTemperature: '',
  embApiStyle: 'same_as_llm',
  embBaseUrl: '',
  embApiKey: '',
  embModel: '',
  maxEmbCandidates: '',
  embBatchSize: '',
  maxChunks: '',
  maxChars: '',
  rateLimitMax: '',
  generateRateLimitMax: '',
};

function formReducer(state: SettingsFormState, action: SettingsAction): SettingsFormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'LOAD':
      return {
        ...state,
        llmApiStyle: action.display.LLM_API_STYLE,
        llmBaseUrl: action.display.LLM_BASE_URL,
        llmModel: action.display.LLM_MODEL,
        llmMaxTokens: String(action.display.LLM_MAX_TOKENS),
        llmTemperature: String(action.display.LLM_TEMPERATURE),
        embApiStyle: action.display.EMBEDDING_API_STYLE,
        embBaseUrl: action.display.EMBEDDING_BASE_URL,
        embModel: action.display.EMBEDDING_MODEL,
        maxEmbCandidates: String(action.display.MAX_EMBEDDING_CANDIDATES),
        embBatchSize: String(action.display.EMBEDDING_BATCH_SIZE),
        maxChunks: String(action.display.MAX_RETRIEVED_CHUNKS),
        maxChars: String(action.display.MAX_RETRIEVED_CHARS),
        rateLimitMax: String(action.display.RATE_LIMIT_MAX_REQUESTS),
        generateRateLimitMax: String(action.display.GENERATE_RATE_LIMIT_MAX_REQUESTS),
      };
    case 'CLEAR_KEYS':
      return { ...state, llmApiKey: '', embApiKey: '' };
    default:
      return state;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Main Component ───────────────────────────────────────────────────────────

export function SettingsPage() {
  const navigate = useNavigate();
  const [display, setDisplay] = useState<SettingsDisplay | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('llm');
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showEmbKey, setShowEmbKey] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});

  const [form, dispatch] = useReducer(formReducer, initialFormState);

  const sections = [
    { id: 'llm', label: 'LLM Provider' },
    { id: 'embedding', label: 'Embedding & Advanced' },
    { id: 'ratelimit', label: 'Rate Limiting' },
    { id: 'security', label: 'Security' },
  ];

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
  }, [display]);

  useEffect(() => {
    req<SettingsDisplay>('/api/settings')
      .then((data) => {
        setDisplay(data);
        dispatch({ type: 'LOAD', display: data });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load settings'));
  }, []);

  function set(field: keyof SettingsFormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      dispatch({ type: 'SET_FIELD', field, value: e.target.value });
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.llmBaseUrl.trim()) e.llmBaseUrl = 'Required';
    else {
      try { new URL(form.llmBaseUrl); } catch { e.llmBaseUrl = 'Must be a valid URL'; }
    }
    if (!form.llmModel.trim()) e.llmModel = 'Required';
    const tokens = Number(form.llmMaxTokens);
    if (!form.llmMaxTokens || isNaN(tokens) || tokens < 1 || !Number.isInteger(tokens)) e.llmMaxTokens = 'Must be a positive integer';
    const temp = Number(form.llmTemperature);
    if (form.llmTemperature === '' || isNaN(temp) || temp < 0 || temp > 2) e.llmTemperature = 'Must be 0–2';
    const emc = Number(form.maxEmbCandidates);
    if (!form.maxEmbCandidates || isNaN(emc) || emc < 20 || emc > 500 || !Number.isInteger(emc)) e.maxEmbCandidates = 'Range: 20–500';
    const ebs = Number(form.embBatchSize);
    if (!form.embBatchSize || isNaN(ebs) || ebs < 4 || ebs > 256 || !Number.isInteger(ebs)) e.embBatchSize = 'Range: 4–256';
    const mc = Number(form.maxChunks);
    if (!form.maxChunks || isNaN(mc) || mc < 4 || mc > 40 || !Number.isInteger(mc)) e.maxChunks = 'Range: 4–40';
    const mch = Number(form.maxChars);
    if (!form.maxChars || isNaN(mch) || mch < 4000 || mch > 120000 || !Number.isInteger(mch)) e.maxChars = 'Range: 4000–120000';
    const rl = Number(form.rateLimitMax);
    if (!form.rateLimitMax || isNaN(rl) || rl < 1 || !Number.isInteger(rl)) e.rateLimitMax = 'Must be a positive integer';
    const grl = Number(form.generateRateLimitMax);
    if (!form.generateRateLimitMax || isNaN(grl) || grl < 1 || !Number.isInteger(grl)) e.generateRateLimitMax = 'Must be a positive integer';
    return e;
  }

  async function save() {
    const errors = validate();
    setErrs(errors);
    if (Object.keys(errors).length) return;

    setSaving(true); setSaveError(null); setSaveSuccess(false);
    try {
      const body: Record<string, unknown> = {
        LLM_API_STYLE: form.llmApiStyle,
        LLM_BASE_URL: form.llmBaseUrl.trim(),
        LLM_MODEL: form.llmModel.trim(),
        LLM_MAX_TOKENS: Number(form.llmMaxTokens),
        LLM_TEMPERATURE: Number(form.llmTemperature),
        EMBEDDING_API_STYLE: form.embApiStyle,
        EMBEDDING_BASE_URL: form.embBaseUrl.trim() || undefined,
        EMBEDDING_MODEL: form.embModel.trim() || undefined,
        MAX_EMBEDDING_CANDIDATES: Number(form.maxEmbCandidates),
        EMBEDDING_BATCH_SIZE: Number(form.embBatchSize),
        MAX_RETRIEVED_CHUNKS: Number(form.maxChunks),
        MAX_RETRIEVED_CHARS: Number(form.maxChars),
        RATE_LIMIT_MAX_REQUESTS: Number(form.rateLimitMax),
        GENERATE_RATE_LIMIT_MAX_REQUESTS: Number(form.generateRateLimitMax),
      };
      if (form.llmApiKey.trim()) body.LLM_API_KEY = form.llmApiKey.trim();
      if (form.embApiKey.trim()) body.EMBEDDING_API_KEY = form.embApiKey.trim();

      const updated = await req<SettingsDisplay>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setDisplay(updated);
      dispatch({ type: 'CLEAR_KEYS' });
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
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Settings</h2>
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
                      <SettingsSelect value={form.llmApiStyle} onChange={set('llmApiStyle')}>
                        <option value="openai_compatible">OpenAI Compatible (LiteLLM, Ollama…)</option>
                        <option value="openai">OpenAI</option>
                        <option value="anthropic">Anthropic</option>
                      </SettingsSelect>
                    </SettingsField>
                    <SettingsField label="Base URL" error={errs.llmBaseUrl} hint="e.g. https://api.openai.com/v1">
                      <SettingsInput value={form.llmBaseUrl} onChange={set('llmBaseUrl')} placeholder="https://api.openai.com/v1" />
                    </SettingsField>
                  </div>

                  <SettingsField
                    label="API Key"
                    hint={display?.LLM_API_KEY_MASKED ? `Current: ${display.LLM_API_KEY_MASKED} — Leave blank to keep.` : 'No key saved yet.'}
                  >
                    <div className="relative">
                      <SettingsInput
                        type={showLlmKey ? 'text' : 'password'}
                        value={form.llmApiKey}
                        onChange={set('llmApiKey')}
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
                      <SettingsInput value={form.llmModel} onChange={set('llmModel')} placeholder="gpt-4o-mini" />
                    </SettingsField>
                    <SettingsField label="Max Tokens *" error={errs.llmMaxTokens}>
                      <SettingsInput type="number" min={1} value={form.llmMaxTokens} onChange={set('llmMaxTokens')} placeholder="2000" />
                    </SettingsField>
                  </div>

                  <SettingsField label={`Temperature: ${form.llmTemperature}`} error={errs.llmTemperature} hint="0 = precise, 2 = very creative">
                    <input
                      type="range" min={0} max={2} step={0.1}
                      value={form.llmTemperature}
                      onChange={set('llmTemperature')}
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
                  <div className="p-6 border-b border-border-subtle space-y-6">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Embedding Model</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SettingsField label="API Style">
                        <SettingsSelect value={form.embApiStyle} onChange={set('embApiStyle')}>
                          <option value="same_as_llm">Same as LLM</option>
                          <option value="openai_compatible">OpenAI Compatible</option>
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                        </SettingsSelect>
                      </SettingsField>
                      <SettingsField label="Model Name">
                        <SettingsInput value={form.embModel} onChange={set('embModel')} placeholder="text-embedding-3-small" />
                      </SettingsField>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SettingsField label="Base URL" hint="Leave blank to inherit from LLM">
                        <SettingsInput value={form.embBaseUrl} onChange={set('embBaseUrl')} placeholder="https://api.openai.com/v1" />
                      </SettingsField>
                      <SettingsField
                        label="API Key"
                        hint={display?.EMBEDDING_API_KEY_MASKED ? `Current: ${display.EMBEDDING_API_KEY_MASKED} — Leave blank to keep.` : 'Leave blank to use LLM key.'}
                      >
                        <div className="relative">
                          <SettingsInput
                            type={showEmbKey ? 'text' : 'password'}
                            value={form.embApiKey}
                            onChange={set('embApiKey')}
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

                  <div className="p-6 bg-surface-container-low space-y-6">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Retrieval Parameters</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <SettingsField label="Max Embedding Candidates *" error={errs.maxEmbCandidates} hint="Range: 20–500">
                        <SettingsInput type="number" min={20} max={500} value={form.maxEmbCandidates} onChange={set('maxEmbCandidates')} />
                      </SettingsField>
                      <SettingsField label="Embedding Batch Size *" error={errs.embBatchSize} hint="Range: 4–256">
                        <SettingsInput type="number" min={4} max={256} value={form.embBatchSize} onChange={set('embBatchSize')} />
                      </SettingsField>
                      <SettingsField label="Max Retrieved Chunks *" error={errs.maxChunks} hint="Range: 4–40">
                        <SettingsInput type="number" min={4} max={40} value={form.maxChunks} onChange={set('maxChunks')} />
                      </SettingsField>
                      <SettingsField label="Max Retrieved Chars *" error={errs.maxChars} hint="Range: 4000–120000">
                        <SettingsInput type="number" min={4000} max={120000} value={form.maxChars} onChange={set('maxChars')} />
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
                      <SettingsInput type="number" min={1} value={form.rateLimitMax} onChange={set('rateLimitMax')} />
                    </SettingsField>
                    <SettingsField label="Generate Max Requests / window *" error={errs.generateRateLimitMax} hint="Limit for quiz generation endpoint (expensive)">
                      <SettingsInput type="number" min={1} value={form.generateRateLimitMax} onChange={set('generateRateLimitMax')} />
                    </SettingsField>
                  </div>
                </div>
              </section>

              {/* Security */}
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
