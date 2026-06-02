import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { req } from '../api';
import type { QuizShare } from '../types';

// ─── Shares Page (/shares) ────────────────────────────────────────────────────

export function SharesPage() {
  const [shares, setShares] = useState<QuizShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await req<QuizShare[]>('/api/shares');
      setShares(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load shares');
    } finally {
      setLoading(false);
    }
  }

  async function deleteShare(id: string) {
    if (!confirm('Delete this share link?')) return;
    await req<void>(`/api/shares/${id}`, { method: 'DELETE' });
    await load();
  }

  function copyLink(share: QuizShare) {
    const url = `${(window.__APP_CONFIG__?.publicUrl ?? '').replace(/\/$/, '')}/public/s/${share.token}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(share.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  useEffect(() => { void load(); }, []);

  function attemptsLabel(share: QuizShare) {
    if (share.maxAttempts === null) return `${share.attemptCount} / ∞`;
    return `${share.attemptCount} / ${share.maxAttempts}`;
  }

  function expiryLabel(share: QuizShare) {
    if (!share.expiresAt) return '—';
    const d = new Date(share.expiresAt);
    const expired = d < new Date();
    return (
      <span className={expired ? 'text-error' : 'text-text-muted'}>
        {d.toLocaleDateString()}{expired ? ' (expired)' : ''}
      </span>
    );
  }

  return (
    <>
      <header className="flex items-center justify-between h-16 px-6 border-b border-border-subtle z-10 shrink-0" style={{ backgroundColor: '#141313' }}>
        <h2 className="text-[14px] font-semibold text-on-surface font-geist">Shares</h2>
        <button onClick={() => void load()} className="flex items-center gap-2 px-3 py-1.5 border border-border-subtle rounded text-[12px] text-text-muted hover:text-secondary hover:border-secondary transition-colors bg-surface-container-low">
          <Icon name="refresh" size={16} /> Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6" style={{ backgroundColor: '#141313' }}>
        <div className="max-w-[1200px] mx-auto w-full flex flex-col gap-6">
          {error && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[14px] text-on-error-container">{error}</div>}

          <div className="border border-border-subtle rounded-lg bg-surface-container-low overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-4 p-4 border-b border-border-subtle bg-surface-variant/50 text-[12px] font-medium text-text-muted">
              <div className="col-span-3">Quiz</div>
              <div className="col-span-2">Guest</div>
              <div className="col-span-3">Link</div>
              <div className="col-span-1 text-center">Attempts</div>
              <div className="col-span-2 hidden md:block">Expires</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-text-muted text-[14px]">Loading...</div>
            ) : shares.length === 0 ? (
              <div className="p-8 text-center">
                <Icon name="link_off" size={32} className="text-text-muted mx-auto mb-3" />
                <p className="text-text-muted text-[14px]">No share links yet.</p>
                <p className="text-[12px] text-text-muted mt-1">Open a quiz and click the share icon to create one.</p>
              </div>
            ) : shares.map((share) => {
              const isExhausted = share.maxAttempts !== null && share.attemptCount >= share.maxAttempts;
              const isExpired = share.expiresAt ? new Date(share.expiresAt) < new Date() : false;
              const inactive = isExhausted || isExpired;

              return (
                <div key={share.id} className={`grid grid-cols-12 gap-4 p-4 border-b border-border-subtle last:border-b-0 items-center transition-colors ${inactive ? 'opacity-50' : 'hover:bg-surface-variant/20'}`}>
                  <div className="col-span-3 flex flex-col min-w-0">
                    <span className="text-[13px] text-on-surface font-medium truncate">{share.quizTitle ?? '—'}</span>
                    <span className="text-[11px] text-text-muted">{new Date(share.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="col-span-2 flex items-center gap-1.5 min-w-0">
                    <Icon name="person" size={14} className="text-text-muted shrink-0" />
                    <span className="text-[13px] text-on-surface truncate">{share.guestName}</span>
                  </div>
                  <div className="col-span-3 min-w-0">
                    <button
                      onClick={() => copyLink(share)}
                      className="flex items-center gap-1.5 text-secondary hover:opacity-80 transition-opacity max-w-full"
                      title="Copy link"
                    >
                      <Icon name={copiedId === share.id ? 'check' : 'content_copy'} size={14} className={copiedId === share.id ? 'text-success shrink-0' : 'shrink-0'} />
                      <span className="text-[12px] font-mono truncate">{share.token.slice(0, 12)}…</span>
                    </button>
                  </div>
                  <div className="col-span-1 text-center">
                    <span className={`text-[12px] font-medium ${isExhausted ? 'text-error' : 'text-text-muted'}`}>{attemptsLabel(share)}</span>
                  </div>
                  <div className="col-span-2 hidden md:block text-[12px]">{expiryLabel(share)}</div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={() => void deleteShare(share.id)}
                      className="text-text-muted hover:text-error transition-colors p-1"
                      title="Delete share"
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
