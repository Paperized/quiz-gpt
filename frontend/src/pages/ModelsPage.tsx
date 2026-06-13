import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.js';
import { req } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Model, Provider } from '../types.js';

type Tab = 'providers' | 'models';

export function ModelsPage() {
  const { user } = useAuth();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [provLoading, setProvLoading] = useState(true);
  const [provError, setProvError] = useState('');

  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const [tab, setTab] = useState<Tab>('models');
  const [createType, setCreateType] = useState<'llm' | 'embedding' | null>(null);
  const [editModel, setEditModel] = useState<Model | null>(null);
  const [detailModel, setDetailModel] = useState<Model | null>(null);

  const isAdmin = user?.role !== 'user';

  const fetchProviders = useCallback(async () => {
    try { setProvError(''); const data = await req<Provider[]>('/api/providers'); setProviders(data); }
    catch (err) { setProvError(err instanceof Error ? err.message : 'Failed'); }
    finally { setProvLoading(false); }
  }, []);

  const fetchModels = useCallback(async () => {
    try { setModelsError(''); const data = await req<Model[]>('/api/models'); setModels(data); }
    catch (err) { setModelsError(err instanceof Error ? err.message : 'Failed'); }
    finally { setModelsLoading(false); }
  }, []);

  useEffect(() => { void fetchProviders(); void fetchModels(); }, [fetchProviders, fetchModels]);

  async function handleDeleteModel(m: Model) {
    if (!confirm(`Delete "${m.label}"?`)) return;
    try { await req(`/api/models/${m.id}`, { method: 'DELETE' }); await fetchModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function handleSetDefault(m: Model) {
    try { await req(`/api/models/${m.id}/default`, { method: 'PUT' }); await fetchModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Models</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[900px] mx-auto w-full flex flex-col gap-6">
          <div className="flex gap-1 border-b border-border-subtle">
            {(['providers', 'models'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-6 py-3 text-[12px] font-medium capitalize transition-colors ${tab === t ? 'text-primary font-bold border-b-2 border-secondary' : 'text-text-muted hover:text-secondary'}`}>{t}</button>
            ))}
          </div>

          {tab === 'providers' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Providers</h3>
                <button onClick={() => { const l = prompt('Label:'); const p = prompt('Provider:'); const u = prompt('Base URL (optional):'); const k = prompt('API Key:'); if (l && p && k) req('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: l, provider: p, apiKey: k, baseUrl: u || undefined }) }).then(() => fetchProviders()); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-medium hover:opacity-90 transition-opacity"><Icon name="add" size={14} />New Provider</button>
              </div>
              {provError && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{provError}</div>}
              {provLoading ? <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div> : <>
                {providers.length === 0 && <p className="text-[13px] text-text-muted italic">No providers yet.</p>}
                {providers.map(p => (
                  <div key={p.id} className="bg-surface-container rounded-lg border border-border-subtle p-4 flex items-center justify-between">
                    <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[13px] font-medium text-on-surface truncate">{p.label}</span>{p.isSystem && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary font-medium shrink-0">SYSTEM</span>}</div><div className="text-[11px] text-text-muted mt-0.5">{p.provider} · Key: {p.apiKeyMasked}</div></div>
                    <button onClick={async () => { if (!confirm(`Delete "${p.label}"?`)) return; try { await req(`/api/providers/${p.id}`, { method: 'DELETE' }); await fetchProviders(); } catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); } }} className="text-text-muted hover:text-error transition-colors p-1"><Icon name="delete" size={14} /></button>
                  </div>
                ))}
              </>}
            </>
          )}

          {tab === 'models' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Models</h3>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCreateType('llm')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-medium hover:opacity-90 transition-opacity"><Icon name="add" size={14} />LLM</button>
                  <button onClick={() => setCreateType('embedding')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-subtle text-text-muted text-[12px] font-medium hover:border-secondary hover:text-secondary transition-colors"><Icon name="add" size={14} />Embedding</button>
                </div>
              </div>
              {modelsError && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{modelsError}</div>}
              {modelsLoading ? <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div> : <>
                {models.length === 0 && <p className="text-[13px] text-text-muted italic">No models yet.</p>}
                <div className="space-y-2">
                  {models.map(m => (
                    <div key={m.id} className="bg-surface-container rounded-lg border border-border-subtle p-4 flex items-center justify-between">
                      <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[13px] font-medium text-on-surface truncate">{m.label}</span><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${m.modelType === 'llm' ? 'bg-primary/10 text-primary' : 'bg-amber-500/15 text-amber-400'}`}>{m.modelType}</span>{m.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium shrink-0">DEFAULT</span>}</div><div className="text-[11px] text-text-muted mt-0.5">{m.provider} · {m.modelId} · Key: {m.apiKeyMasked}</div></div>
                      <div className="flex items-center gap-1 shrink-0 ml-4">
                        <button onClick={() => handleSetDefault(m)} className={`text-text-muted hover:text-yellow-400 transition-colors p-1 ${m.isDefault ? 'text-yellow-400' : ''}`}><Icon name="bolt" size={14} /></button>
                        <button onClick={() => handleDeleteModel(m)} className="text-text-muted hover:text-error transition-colors p-1"><Icon name="delete" size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>}
            </>
          )}
        </div>
      </div>

      {createType && <ModelFormSimple modelType={createType} providers={providers} onClose={() => setCreateType(null)} onSaved={fetchModels} />}
      {editModel && <ModelFormSimple modelType={editModel.modelType} edit={editModel} providers={providers} onClose={() => setEditModel(null)} onSaved={fetchModels} />}
      {detailModel && <ModelDetailSimple model={detailModel} onClose={() => setDetailModel(null)} />}
    </>
  );
}

function ModelFormSimple({ modelType, edit, providers, onClose, onSaved }: { modelType: 'llm' | 'embedding'; edit?: Model; providers: Provider[]; onClose: () => void; onSaved: () => void }) {
  const [configMode, setConfigMode] = useState<'provider' | 'manual'>(edit?.providerId ? 'provider' : 'manual');
  const [selectedProvId, setSelectedProvId] = useState(edit?.providerId ?? '');
  const [label, setLabel] = useState(edit?.label ?? '');
  const [provider, setProvider] = useState(edit?.provider ?? '');
  const [modelId, setModelId] = useState(edit?.modelId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(edit?.baseUrl ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSubmitting(true);
    try {
      const body: Record<string, unknown> = { label, modelId };
      if (configMode === 'provider' && selectedProvId) { body.providerId = selectedProvId; }
      else { body.provider = provider; body.apiKey = apiKey || undefined; body.baseUrl = baseUrl || undefined; }
      if (edit) body.modelType = undefined; else body.modelType = modelType;
      if (edit) await req(`/api/models/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      else await req('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-3 shrink-0"><div className="flex items-center justify-between"><h3 className="text-[16px] font-bold text-on-surface">{edit ? 'Edit Model' : `New ${modelType === 'llm' ? 'LLM' : 'Embedding'} Model`}</h3><button onClick={onClose} className="text-text-muted hover:text-on-surface"><Icon name="close" size={18} /></button></div></div>
        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto px-6 flex flex-col gap-3 pb-3">
            <div className="flex gap-1 p-0.5 rounded-lg bg-surface-container-highest">
              <button type="button" onClick={() => setConfigMode('provider')} className={`flex-1 py-1.5 rounded-md text-[12px] font-medium transition-colors ${configMode === 'provider' ? 'bg-primary text-on-primary' : 'text-text-muted hover:text-on-surface'}`}>From Providers</button>
              <button type="button" onClick={() => setConfigMode('manual')} className={`flex-1 py-1.5 rounded-md text-[12px] font-medium transition-colors ${configMode === 'manual' ? 'bg-primary text-on-primary' : 'text-text-muted hover:text-on-surface'}`}>Manual</button>
            </div>
            {configMode === 'provider' && (
              <div className="relative">
                <select value={selectedProvId} onChange={e => { setSelectedProvId(e.target.value); const p = providers.find(x => x.id === e.target.value); if (p) { setProvider(p.provider); setBaseUrl(p.baseUrl ?? ''); } }} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface appearance-none focus:outline-none focus:border-primary">
                  <option value="">Select a provider...</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.label} ({p.provider})</option>)}
                </select>
                <Icon name="expand_more" size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            )}
            <input type="text" placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            <input type="text" placeholder="Model ID (e.g. gpt-4o)" value={modelId} onChange={e => setModelId(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            {configMode === 'manual' && (<>
              <select value={provider} onChange={e => setProvider(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface appearance-none focus:outline-none focus:border-primary">
                <option value="">Select provider...</option>
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="openai_compatible">openai_compatible</option>
              </select>
              <input type="text" placeholder="Base URL (optional)" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
              <input type="password" placeholder={edit ? 'New API Key (leave empty to keep)' : 'API Key'} value={apiKey} onChange={e => setApiKey(e.target.value)} required={!edit} autoComplete="off" data-form-type="other" className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            </>)}
            {error && <p className="text-error text-[12px]">{error}</p>}
          </div>
          <div className="shrink-0 px-6 py-4 border-t border-border-subtle">
            <button type="submit" disabled={submitting} className="w-full py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50">{submitting ? 'Saving...' : edit ? 'Save Changes' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModelDetailSimple({ model, onClose }: { model: Model; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4"><h3 className="text-[16px] font-bold text-on-surface">{model.label}</h3><button onClick={onClose} className="text-text-muted hover:text-on-surface"><Icon name="close" size={18} /></button></div>
        <div className="space-y-3 text-[13px]">
          <div><span className="text-text-muted">Type: </span>{model.modelType}</div>
          <div><span className="text-text-muted">Provider: </span>{model.provider}</div>
          <div><span className="text-text-muted">Model ID: </span>{model.modelId}</div>
          <div><span className="text-text-muted">API Key: </span>{model.apiKeyMasked}</div>
          {model.baseUrl && <div><span className="text-text-muted">Base URL: </span>{model.baseUrl}</div>}
          {model.isDefault && <div className="text-green-400">Default model</div>}
        </div>
        <button onClick={onClose} className="mt-6 w-full py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity">Close</button>
      </div>
    </div>
  );
}
