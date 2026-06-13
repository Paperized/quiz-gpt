import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.js';
import { req } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { AuthUser, Model } from '../types.js';

type Tab = 'users' | 'models';

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState('');

  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  const [createType, setCreateType] = useState<'llm' | 'embedding' | null>(null);
  const [editModel, setEditModel] = useState<Model | null>(null);
  const [detailModel, setDetailModel] = useState<Model | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const isAdmin = user?.role !== 'user';

  const fetchUsers = useCallback(async () => {
    try { setUsersError(''); const data = await req<AuthUser[]>('/api/users'); setUsers(data); }
    catch (err) { setUsersError(err instanceof Error ? err.message : 'Failed'); }
    finally { setUsersLoading(false); }
  }, []);

  const fetchModels = useCallback(async () => {
    try { setModelsError(''); const data = await req<Model[]>('/api/models'); setModels(data); }
    catch (err) { setModelsError(err instanceof Error ? err.message : 'Failed'); }
    finally { setModelsLoading(false); }
  }, []);

  useEffect(() => { void fetchUsers(); void fetchModels(); }, [fetchUsers, fetchModels]);

  async function toggleRole(u: AuthUser) {
    if (u.id === user?.id) return;
    try {
      await req(`/api/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: u.role === 'admin' ? 'user' : 'admin' }) });
      await fetchUsers();
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  async function handleDeleteUser(u: AuthUser) {
    if (!confirm(`Delete "${u.name || u.email}"?`)) return;
    try { await req(`/api/users/${u.id}`, { method: 'DELETE' }); await fetchUsers(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function handleDeleteModel(m: Model) {
    if (!confirm(`Delete "${m.label}"?`)) return;
    try { await req(`/api/models/${m.id}`, { method: 'DELETE' }); await fetchModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Delete failed'); }
  }

  async function handleSetDefault(m: Model) {
    try { await req(`/api/models/${m.id}/default`, { method: 'PUT' }); await fetchModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Failed'); }
  }

  async function handleGrant(modelId: string) {
    const userId = prompt('Enter user ID:');
    if (!userId) return;
    try { await req(`/api/models/${modelId}/access`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) }); await fetchModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Grant failed'); }
  }

  async function handleRevoke(modelId: string, userId: string) {
    try { await req(`/api/models/${modelId}/access/${userId}`, { method: 'DELETE' }); await fetchModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Revoke failed'); }
  }

  const systemModels = models.filter(m => m.isSystem);
  const userModels = models.filter(m => !m.isSystem);

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Admin</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[900px] mx-auto w-full flex flex-col gap-6">
          <div className="flex gap-1 border-b border-border-subtle">
            {(['users', 'models'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} className={`px-6 py-3 text-[12px] font-medium capitalize transition-colors ${tab === t ? 'text-primary font-bold border-b-2 border-secondary' : 'text-text-muted hover:text-secondary'}`}>{t}</button>
            ))}
          </div>

          {tab === 'users' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Users</h3>
                <button onClick={() => setShowCreateUser(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-medium hover:opacity-90 transition-opacity"><Icon name="add" size={14} />New User</button>
              </div>
              {usersError && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{usersError}</div>}
              {usersLoading ? <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div> : (
                <div className="bg-surface-container rounded-xl border border-border-subtle overflow-hidden">
                  <table className="w-full">
                    <thead><tr className="border-b border-border-subtle"><th className="text-left px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">User</th><th className="text-left px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Role</th><th className="text-left px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Provider</th><th className="text-right px-4 py-3 text-[11px] font-bold text-text-muted uppercase tracking-[0.1em]">Actions</th></tr></thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="border-b border-border-subtle last:border-b-0">
                          <td className="px-4 py-3"><div className="text-[13px] font-medium text-on-surface">{u.name || u.email}</div><div className="text-[11px] text-text-muted">{u.email}</div></td>
                          <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${u.role === 'super_admin' ? 'bg-amber-500/15 text-amber-400' : u.role === 'admin' ? 'bg-secondary/10 text-secondary' : 'bg-surface-container-highest text-text-muted'}`}>{u.role === 'super_admin' ? 'Super Admin' : u.role}</span></td>
                          <td className="px-4 py-3"><span className="text-[12px] text-text-muted">{u.authProvider}</span></td>
                          <td className="px-4 py-3 text-right"><div className="flex items-center justify-end gap-3">
                            {u.role === 'super_admin' ? <span className="text-[11px] text-text-muted italic">Protected</span> : u.id === user?.id ? <span className="text-[11px] text-text-muted italic">You</span> : <><button onClick={() => toggleRole(u)} className="text-[12px] font-medium text-primary hover:text-secondary transition-colors">{u.role === 'admin' ? 'Demote to user' : 'Promote to admin'}</button><button onClick={() => handleDeleteUser(u)} className="text-[12px] text-text-muted hover:text-error transition-colors"><Icon name="delete" size={14} /></button></>}
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
              {modelsLoading ? <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div> : (<>
                {systemModels.length > 0 && <div className="space-y-2">{systemModels.map(m => <ModelCard key={m.id} model={m} isAdmin={!!isAdmin} onDelete={handleDeleteModel} onSetDefault={handleSetDefault} onDetail={setDetailModel} onEdit={setEditModel} onGrant={handleGrant} onRevoke={handleRevoke} />)}</div>}
                <div className="space-y-2">{userModels.map(m => <ModelCard key={m.id} model={m} isAdmin={!!isAdmin} onDelete={handleDeleteModel} onSetDefault={handleSetDefault} onDetail={setDetailModel} onEdit={setEditModel} onGrant={handleGrant} onRevoke={handleRevoke} />)}{userModels.length === 0 && systemModels.length === 0 && <p className="text-[13px] text-text-muted italic">No models yet.</p>}</div>
              </>)}
            </>
          )}
        </div>
      </div>

      {createType && <ModelForm modelType={createType} onClose={() => setCreateType(null)} onSaved={fetchModels} />}
      {editModel && <ModelForm modelType={editModel.modelType} edit={editModel} onClose={() => setEditModel(null)} onSaved={fetchModels} />}
      {detailModel && <ModelDetail model={detailModel} onClose={() => setDetailModel(null)} onEdit={() => { const m = detailModel; setDetailModel(null); setEditModel(m); }} />}
      {showCreateUser && <CreateUserForm onClose={() => setShowCreateUser(false)} onCreated={fetchUsers} />}
    </>
  );
}

function ModelCard({ model, isAdmin, onDelete, onSetDefault, onDetail, onEdit, onGrant, onRevoke }: {
  model: Model; isAdmin: boolean; onDelete: (m: Model) => void; onSetDefault: (m: Model) => void;
  onDetail: (m: Model) => void; onEdit: (m: Model) => void;
  onGrant: (id: string) => void; onRevoke: (id: string, userId: string) => void;
}) {
  return (
    <div className="bg-surface-container rounded-lg border border-border-subtle p-4 flex items-center justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-on-surface truncate">{model.label}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${model.modelType === 'llm' ? 'bg-primary/10 text-primary' : 'bg-amber-500/15 text-amber-400'}`}>{model.modelType}</span>
          {model.isSystem && <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary font-medium shrink-0">SYSTEM</span>}
          {model.isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium shrink-0">DEFAULT</span>}
        </div>
        <div className="text-[11px] text-text-muted mt-0.5">{model.provider} · {model.modelId} · Key: {model.apiKeyMasked}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-4">
        <button onClick={() => onSetDefault(model)} className="text-text-muted hover:text-yellow-400 transition-colors p-1" title="Set as default"><Icon name="bolt" size={14} className={model.isDefault ? 'text-yellow-400' : ''} /></button>
        <button onClick={() => onDetail(model)} className="text-text-muted hover:text-on-surface transition-colors p-1" title="View details"><Icon name="search" size={14} /></button>
        <button onClick={() => onEdit(model)} className="text-text-muted hover:text-secondary transition-colors p-1" title="Edit"><Icon name="edit" size={14} /></button>
        <button onClick={() => onDelete(model)} className="text-text-muted hover:text-error transition-colors p-1" title="Delete"><Icon name="delete" size={14} /></button>
      </div>
    </div>
  );
}

function ModelDetail({ model, onClose, onEdit }: { model: Model; onClose: () => void; onEdit: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-on-surface">{model.label}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface"><Icon name="close" size={18} /></button>
        </div>
        <div className="space-y-3 text-[13px]">
          <div><span className="text-text-muted">Type: </span><span className="text-on-surface">{model.modelType}</span></div>
          <div><span className="text-text-muted">Provider: </span><span className="text-on-surface">{model.provider}</span></div>
          <div><span className="text-text-muted">Model ID: </span><span className="text-on-surface">{model.modelId}</span></div>
          <div><span className="text-text-muted">API Key: </span><span className="text-on-surface">{model.apiKeyMasked}</span></div>
          {model.baseUrl && <div><span className="text-text-muted">Base URL: </span><span className="text-on-surface">{model.baseUrl}</span></div>}
          {model.modelType === 'llm' && (<>
            {model.maxTokens && <div><span className="text-text-muted">Max Tokens: </span><span className="text-on-surface">{model.maxTokens}</span></div>}
            {model.temperature != null && <div><span className="text-text-muted">Temperature: </span><span className="text-on-surface">{model.temperature}</span></div>}
          </>)}
          {model.modelType === 'embedding' && (<>
            {model.maxEmbeddingCandidates && <div><span className="text-text-muted">Max Candidates: </span><span className="text-on-surface">{model.maxEmbeddingCandidates}</span></div>}
            {model.maxRetrievedChunks && <div><span className="text-text-muted">Max Chunks: </span><span className="text-on-surface">{model.maxRetrievedChunks}</span></div>}
            {model.maxRetrievedChars && <div><span className="text-text-muted">Max Chars: </span><span className="text-on-surface">{model.maxRetrievedChars}</span></div>}
            {model.embeddingBatchSize && <div><span className="text-text-muted">Batch Size: </span><span className="text-on-surface">{model.embeddingBatchSize}</span></div>}
          </>)}
          {model.isSystem && <div><span className="text-text-muted">System model</span></div>}
          {model.isDefault && <div><span className="text-green-400">Default model</span></div>}
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onEdit} className="flex-1 py-2 rounded-lg border border-border-subtle text-[13px] font-medium text-text-muted hover:border-secondary hover:text-secondary transition-colors">Edit</button>
          <button onClick={onClose} className="flex-1 py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity">Close</button>
        </div>
      </div>
    </div>
  );
}

function ModelForm({ modelType, edit, onClose, onSaved }: { modelType: 'llm' | 'embedding'; edit?: Model; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(edit?.label ?? '');
  const [provider, setProvider] = useState(edit?.provider ?? '');
  const [modelId, setModelId] = useState(edit?.modelId ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(edit?.baseUrl ?? '');
  const [maxTokens, setMaxTokens] = useState(edit?.maxTokens?.toString() ?? '');
  const [temperature, setTemperature] = useState(edit?.temperature?.toString() ?? '');
  const [maxCandidates, setMaxCandidates] = useState(edit?.maxEmbeddingCandidates?.toString() ?? '');
  const [maxChunks, setMaxChunks] = useState(edit?.maxRetrievedChunks?.toString() ?? '');
  const [maxChars, setMaxChars] = useState(edit?.maxRetrievedChars?.toString() ?? '');
  const [batchSize, setBatchSize] = useState(edit?.embeddingBatchSize?.toString() ?? '');
  const [isSystem, setIsSystem] = useState(edit?.isSystem ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSubmitting(true);
    try {
      const body: Record<string, unknown> = { label, provider, modelId, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined };
      if (edit) body.modelType = undefined;
      else body.modelType = modelType;
      if (modelType === 'llm') {
        if (maxTokens) body.maxTokens = Number(maxTokens);
        if (temperature) body.temperature = Number(temperature);
      } else {
        if (maxCandidates) body.maxEmbeddingCandidates = Number(maxCandidates);
        if (maxChunks) body.maxRetrievedChunks = Number(maxChunks);
        if (maxChars) body.maxRetrievedChars = Number(maxChars);
        if (batchSize) body.embeddingBatchSize = Number(batchSize);
      }
      if (!edit) body.isSystem = isSystem;
      if (edit) {
        await req(`/api/models/${edit.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await req('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-on-surface">{edit ? 'Edit Model' : `New ${modelType === 'llm' ? 'LLM' : 'Embedding'} Model`}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface"><Icon name="close" size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input type="text" placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <input type="text" placeholder="Provider (e.g. openai_compatible)" value={provider} onChange={e => setProvider(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <input type="text" placeholder="Model ID (e.g. gpt-4o)" value={modelId} onChange={e => setModelId(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <input type="text" placeholder="Base URL (optional)" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <input type="password" placeholder={edit ? 'New API Key (leave empty to keep)' : 'API Key'} value={apiKey} onChange={e => setApiKey(e.target.value)} required={!edit} autoComplete="off" data-form-type="other" className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />

          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-secondary transition-colors">
            <Icon name={showAdvanced ? 'expand_more' : 'chevron_right'} size={16} />Advanced
          </button>

          {showAdvanced && modelType === 'llm' && (<>
            <input type="number" placeholder="Max Tokens (default 2000)" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            <input type="number" step="0.1" placeholder="Temperature (default 0.7)" value={temperature} onChange={e => setTemperature(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          </>)}
          {showAdvanced && modelType === 'embedding' && (<>
            <input type="number" placeholder="Max Embedding Candidates (default 220)" value={maxCandidates} onChange={e => setMaxCandidates(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            <input type="number" placeholder="Max Retrieved Chunks (default 16)" value={maxChunks} onChange={e => setMaxChunks(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            <input type="number" placeholder="Max Retrieved Chars (default 28000)" value={maxChars} onChange={e => setMaxChars(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
            <input type="number" placeholder="Embedding Batch Size (default 64)" value={batchSize} onChange={e => setBatchSize(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          </>)}

          {!edit && isAdmin && <label className="flex items-center gap-2 text-[12px] text-text-muted cursor-pointer"><input type="checkbox" checked={isSystem} onChange={e => setIsSystem(e.target.checked)} />System model</label>}
          {error && <p className="text-error text-[12px]">{error}</p>}
          <button type="submit" disabled={submitting} className="w-full py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50">{submitting ? 'Saving...' : edit ? 'Save Changes' : 'Create'}</button>
        </form>
      </div>
    </div>
  );
}

function CreateUserForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError(''); setSubmitting(true);
    try {
      await req('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name: name || undefined, role }) });
      onCreated(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-on-surface">New User</h3>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface"><Icon name="close" size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <input type="password" placeholder="Password (min 8 chars)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="off" data-form-type="other" className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary" />
          <div>
            <label className="block text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-1">Role</label>
            <div className="flex gap-2">
              {(['user', 'admin'] as const).map(r => (
                <button key={r} type="button" onClick={() => setRole(r)} className={`flex-1 py-2 rounded-lg border text-[12px] font-medium transition-colors ${role === r ? 'border-primary bg-primary/10 text-primary' : 'border-border-subtle text-text-muted hover:border-secondary'}`}>{r}</button>
              ))}
            </div>
          </div>
          {error && <p className="text-error text-[12px]">{error}</p>}
          <button type="submit" disabled={submitting} className="w-full py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50">{submitting ? 'Creating...' : 'Create User'}</button>
        </form>
      </div>
    </div>
  );
}
