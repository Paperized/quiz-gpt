import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth.js';
import { req } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Model } from '../types.js';

export function ModelsPage() {
  const { user } = useAuth();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const fetchModels = useCallback(async () => {
    try {
      setError('');
      const data = await req<Model[]>('/api/models');
      setModels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchModels(); }, [fetchModels]);

  async function handleDelete(model: Model) {
    if (!confirm(`Delete model "${model.label}"?`)) return;
    try {
      await req(`/api/models/${model.id}`, { method: 'DELETE' });
      await fetchModels();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleGrant(modelId: string) {
    const userId = prompt('Enter user ID to grant access:');
    if (!userId) return;
    try {
      await req(`/api/models/${modelId}/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      await fetchModels();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Grant failed');
    }
  }

  async function handleRevoke(modelId: string, userId: string) {
    try {
      await req(`/api/models/${modelId}/access/${userId}`, { method: 'DELETE' });
      await fetchModels();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  const isAdmin = user?.role === 'admin';
  const systemModels = models.filter((m) => m.isSystem);
  const userModels = models.filter((m) => !m.isSystem);

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Models</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-medium hover:opacity-90 transition-opacity"
        >
          <Icon name="add" size={14} />
          New Model
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[900px] mx-auto w-full flex flex-col gap-6">
          {error && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {systemModels.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-3">System Models</h3>
                  <div className="space-y-2">
                    {systemModels.map((model) => (
                      <ModelCard
                        key={model.id}
                        model={model}
                        isAdmin={isAdmin}
                        onDelete={handleDelete}
                        onGrant={handleGrant}
                        onRevoke={handleRevoke}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.1em] mb-3">
                  {isAdmin ? 'My BYOD Models' : 'My Models'}
                </h3>
                <div className="space-y-2">
                  {userModels.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      isAdmin={isAdmin}
                      onDelete={handleDelete}
                      onGrant={handleGrant}
                      onRevoke={handleRevoke}
                    />
                  ))}
                  {userModels.length === 0 && (
                    <p className="text-[13px] text-text-muted italic">No models yet.</p>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateModelForm
          isAdmin={isAdmin}
          onClose={() => setShowCreate(false)}
          onCreated={fetchModels}
        />
      )}
    </>
  );
}

function ModelCard({ model, isAdmin, onDelete, onGrant, onRevoke }: {
  model: Model;
  isAdmin: boolean;
  onDelete: (m: Model) => void;
  onGrant: (id: string) => void;
  onRevoke: (id: string, userId: string) => void;
}) {
  return (
    <div className="bg-surface-container rounded-lg border border-border-subtle p-4 flex items-center justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-on-surface truncate">{model.label}</span>
          {model.isSystem && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary font-medium shrink-0">SYSTEM</span>
          )}
        </div>
        <div className="text-[11px] text-text-muted mt-0.5">
          {model.provider} · {model.modelId} · Key: {model.apiKeyMasked}
        </div>
        {model.isSystem && model.assignedTo && model.assignedTo.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            <span className="text-[10px] text-text-muted">Access:</span>
            {model.assignedTo.map((uid) => (
              <span key={uid} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-container-highest text-text-muted">
                {uid.slice(0, 8)}...
                {isAdmin && (
                  <button
                    onClick={() => onRevoke(model.id, uid)}
                    className="hover:text-error"
                  >
                    <Icon name="close" size={10} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-4">
        {isAdmin && model.isSystem && (
          <button
            onClick={() => onGrant(model.id)}
            className="px-2 py-1 text-[11px] text-primary hover:text-secondary transition-colors rounded hover:bg-surface-variant"
            title="Grant access to user"
          >
            Grant
          </button>
        )}
        <button
          onClick={() => onDelete(model)}
          className="text-text-muted hover:text-error transition-colors p-1"
          title="Delete model"
        >
          <Icon name="delete" size={14} />
        </button>
      </div>
    </div>
  );
}

function CreateModelForm({ isAdmin, onClose, onCreated }: {
  isAdmin: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isSystem, setIsSystem] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await req('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, provider, modelId, apiKey, isSystem }),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create model');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-surface-container rounded-xl border border-border-subtle shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-bold text-on-surface">New Model</h3>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface">
            <Icon name="close" size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="text" placeholder="Label (e.g. GPT-4o)" value={label}
            onChange={(e) => setLabel(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
          />
          <input
            type="text" placeholder="Provider (e.g. openai_compatible)" value={provider}
            onChange={(e) => setProvider(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
          />
          <input
            type="text" placeholder="Model ID (e.g. gpt-4o)" value={modelId}
            onChange={(e) => setModelId(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
          />
          <input
            type="password" placeholder="API Key" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[13px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
          />
          {isAdmin && (
            <label className="flex items-center gap-2 text-[12px] text-text-muted cursor-pointer">
              <input type="checkbox" checked={isSystem} onChange={(e) => setIsSystem(e.target.checked)} />
              System model (assignable to other users)
            </label>
          )}
          {error && <p className="text-error text-[12px]">{error}</p>}
          <button
            type="submit" disabled={submitting}
            className="w-full py-2 rounded-lg bg-primary text-on-primary text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>
    </div>
  );
}
