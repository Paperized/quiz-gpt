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
  const [detailProv, setDetailProv] = useState<Provider | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, 'loading' | 'ok' | 'error'>>({});

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

  async function handleTestProvider(p: Provider) {
    setTestStatus(s => ({ ...s, [p.id]: 'loading' }));
    try {
      const res = await req<{ ok: boolean; error?: string }>(`/api/providers/${p.id}/test`, { method: 'POST' });
      setTestStatus(s => ({ ...s, [p.id]: res.ok ? 'ok' : 'error' }));
    } catch {
      setTestStatus(s => ({ ...s, [p.id]: 'error' }));
    }
  }

  async function handleTestModel(m: Model) {
    setTestStatus(s => ({ ...s, [m.id]: 'loading' }));
    try {
      const res = await req<{ ok: boolean; error?: string }>(`/api/models/${m.id}/test`, { method: 'POST' });
      setTestStatus(s => ({ ...s, [m.id]: res.ok ? 'ok' : 'error' }));
    } catch {
      setTestStatus(s => ({ ...s, [m.id]: 'error' }));
    }
  }

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Models</h2>
        <span className="flex items-center gap-1 cursor-default" title={user?.encryptionConfigured ? 'API keys encrypted' : 'Encryption key not set — API keys stored in plaintext'}>
          <Icon name="lock" size={14} fill={user?.encryptionConfigured ?? false} className={user?.encryptionConfigured ? 'text-green-400' : 'text-yellow-500'} />
        </span>
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
                    <div className="flex items-center gap-1">
                      {testStatus[p.id] === 'loading' ? (
                        <span className="p-1"><svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></span>
                      ) : (
                        <button onClick={() => handleTestProvider(p)} className={`transition-colors p-1 ${testStatus[p.id] === 'ok' ? 'text-green-400' : testStatus[p.id] === 'error' ? 'text-red-400 hover:text-red-500' : 'text-text-muted hover:text-green-400'}`}><Icon name="bolt" size={12} /></button>
                      )}
                      <button onClick={() => setDetailProv(p)} className="text-text-muted hover:text-on-surface transition-colors p-1"><Icon name="search" size={14} /></button>
                      {!p.isSystem && <button onClick={async () => { if (!confirm(`Delete "${p.label}"?`)) return; try { await req(`/api/providers/${p.id}`, { method: 'DELETE' }); await fetchProviders(); } catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); } }} className="text-text-muted hover:text-error transition-colors p-1"><Icon name="delete" size={14} /></button>}
                    </div>
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
                      <div className="min-w-0"><div className="flex items-center gap-2"><span className="text-[13px] font-medium text-on-surface truncate">{m.label}</span><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${m.modelType === 'llm' ? 'bg-primary/10 text-primary' : 'bg-amber-500/15 text-amber-400'}`}>{m.modelType}</span>{m.isSystem && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary font-medium shrink-0">SYSTEM</span>}{m.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium shrink-0">DEFAULT</span>}</div><div className="text-[11px] text-text-muted mt-0.5">{m.provider} · {m.modelId} · Key: {m.apiKeyMasked}</div></div>
                      <div className="flex items-center gap-1 shrink-0 ml-4">
                        {testStatus[m.id] === 'loading' ? (
                          <span className="p-1"><svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></span>
                        ) : (
                          <button onClick={() => handleTestModel(m)} className={`transition-colors p-1 ${testStatus[m.id] === 'ok' ? 'text-green-400' : testStatus[m.id] === 'error' ? 'text-red-400 hover:text-red-500' : 'text-text-muted hover:text-green-400'}`}><Icon name="bolt" size={12} /></button>
                        )}
                        <button onClick={() => handleSetDefault(m)} className={`text-text-muted hover:text-yellow-400 transition-colors p-1 ${m.isDefault ? 'text-yellow-400' : ''}`}><Icon name="star" size={14} fill={m.isDefault} /></button>
                        <button onClick={() => setDetailModel(m)} className="text-text-muted hover:text-on-surface transition-colors p-1"><Icon name="search" size={14} /></button>
                        {!m.isSystem && <button onClick={() => handleDeleteModel(m)} className="text-text-muted hover:text-error transition-colors p-1"><Icon name="delete" size={14} /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              </>}
            </>
          )}
        </div>
      </div>

      {createType && <ModelFormSimple modelType={createType} providers={providers} onClose={() => setCreateType(null)} onSaved={() => { fetchModels(); setCreateType(null); }} />}
      {editModel && <ModelFormSimple modelType={editModel.modelType} edit={editModel} providers={providers} onClose={() => setEditModel(null)} onSaved={() => { setTestStatus(s => { const ns = { ...s }; delete ns[editModel.id]; return ns; }); fetchModels(); setEditModel(null); }} />}
      {detailModel && <ModelDetailSimple model={detailModel} onClose={() => setDetailModel(null)} onEdit={detailModel.isSystem ? undefined : () => { setDetailModel(null); setEditModel(detailModel); }} />}
      {detailProv && <ProviderDetailSimple provider={detailProv} onClose={() => setDetailProv(null)} />}
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
  const [providerModels, setProviderModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // On edit mount with providerId, fetch provider models
  const [initialModelsFetched, setInitialModelsFetched] = useState(false);
  useEffect(() => {
    if (edit?.providerId && !initialModelsFetched) {
      setInitialModelsFetched(true);
      fetchProviderModels(edit.providerId);
    }
  }, [edit?.providerId, initialModelsFetched]);

  async function fetchProviderModels(provId: string) {
    setLoadingModels(true); setProviderModels([]);
    try {
      const data = await req<{ models: string[] }>(`/api/providers/${provId}/models`);
      setProviderModels(data.models);
    } catch { setProviderModels([]); }
    finally { setLoadingModels(false); }
  }

  function handleProviderChange(provId: string) {
    setSelectedProvId(provId);
    setProviderModels([]);
    if (!provId) return;
    fetchProviderModels(provId);
    const p = providers.find((x) => x.id === provId);
    if (p) { setProvider(p.provider); setBaseUrl(p.baseUrl ?? ''); }
  }

  async function handleTest() {
    if (!modelId) { setTestResult({ ok: false, msg: 'Model ID required' }); return; }
    setTesting(true); setTestResult(null);
    try {
      const body: Record<string, unknown> = { modelId, modelType };
      if (configMode === 'provider' && selectedProvId) {
        body.providerId = selectedProvId;
      } else {
        body.provider = provider;
        body.apiKey = apiKey;
        if (baseUrl) body.baseUrl = baseUrl;
        if (!provider || !apiKey) { setTestResult({ ok: false, msg: 'Provider and API Key required' }); setTesting(false); return; }
      }
      const res = await req<{ ok: boolean; error?: string }>('/api/models/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      setTestResult(res.ok ? { ok: true, msg: 'OK' } : { ok: false, msg: res.error ?? 'Test failed' });
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Test failed' });
    } finally { setTesting(false); }
  }

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
                <select value={selectedProvId} onChange={e => handleProviderChange(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface appearance-none focus:outline-none focus:border-primary">
                  <option value="">Select a provider...</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.label} ({p.provider})</option>)}
                </select>
                <Icon name="expand_more" size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              </div>
            )}
            <input type="text" placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            {configMode === 'provider' ? (<>
              <input type="text" list="simple-provider-model-list" placeholder="Model ID (select or type)" value={modelId} onChange={e => setModelId(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
              {loadingModels && <span className="text-[11px] text-text-muted">Loading models...</span>}
              {providerModels.length > 0 && (
                <datalist id="simple-provider-model-list">
                  {providerModels.map(m => <option key={m} value={m} />)}
                </datalist>
              )}
            </>) : (
              <input type="text" placeholder="Model ID (e.g. gpt-4o)" value={modelId} onChange={e => setModelId(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            )}
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
          {testResult && (
            <p className={`shrink-0 px-6 text-[12px] ${testResult.ok ? 'text-green-400' : 'text-error'}`}>
              {testResult.ok ? '✓' : '✗'} {testResult.msg}
            </p>
          )}
          <div className="shrink-0 px-6 py-4 border-t border-border-subtle flex gap-3">
            {!edit && (
              <button type="button" disabled={testing} onClick={handleTest} className="py-2 rounded-lg border border-border-subtle text-[12px] text-text-muted hover:border-secondary hover:text-secondary transition-colors disabled:opacity-50" style={{ flex: '0 0 25%' }}>
                {testing ? '...' : 'Test'}
              </button>
            )}
            <button type="submit" disabled={submitting} className="flex-1 py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50">{submitting ? 'Saving...' : edit ? 'Save Changes' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProviderDetailSimple({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-on-surface">{provider.label}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface"><Icon name="close" size={18} /></button>
        </div>
        <div className="space-y-3 text-[13px]">
          <div><span className="text-text-muted">Provider: </span><span className="text-on-surface">{provider.provider}</span></div>
          <div><span className="text-text-muted">API Key: </span><span className="text-on-surface">{provider.apiKeyMasked}</span></div>
          {provider.baseUrl && <div><span className="text-text-muted">Base URL: </span><span className="text-on-surface">{provider.baseUrl}</span></div>}
          {provider.isSystem && <div><span className="text-text-muted">System provider</span></div>}
        </div>
        <button onClick={onClose} className="mt-6 w-full py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity">Close</button>
      </div>
    </div>
  );
}

function ModelDetailSimple({ model, onClose, onEdit }: { model: Model; onClose: () => void; onEdit?: () => void }) {
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
        <div className="flex gap-2 mt-6">
          {onEdit && <button onClick={onEdit} className="flex-1 py-2 rounded-lg border border-border-subtle text-[13px] font-medium text-text-muted hover:border-secondary hover:text-secondary transition-colors">Edit</button>}
          <button onClick={onClose} className={`${onEdit ? 'flex-1' : 'w-full'} py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity`}>Close</button>
        </div>
      </div>
    </div>
  );
}
