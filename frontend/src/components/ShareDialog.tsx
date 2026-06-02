import { useState } from 'react';
import { Icon } from '../components/Icon';
import { req } from '../api';
import type { QuizShare } from '../types';

// ─── Share Dialog ─────────────────────────────────────────────────────────────

export function ShareDialog({ quizId, onClose }: { quizId: string; onClose: () => void }) {
  const [guestName, setGuestName] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<QuizShare | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    if (!guestName.trim()) { setError('Guest name is required'); return; }
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = { guestName: guestName.trim() };
      if (maxAttempts.trim()) body.maxAttempts = parseInt(maxAttempts, 10);
      if (expiresAt.trim()) body.expiresAt = new Date(expiresAt).toISOString();
      const share = await req<QuizShare>(`/api/quizzes/${quizId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setCreated(share);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create share link');
    } finally {
      setLoading(false);
    }
  }

  const shareUrl = created
    ? `${(window.__APP_CONFIG__?.publicUrl ?? '').replace(/\/$/, '')}/public/s/${created.token}`
    : '';

  function copy() {
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full md:max-w-md bg-surface-container rounded-t-2xl md:rounded-2xl border border-border-subtle shadow-2xl p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="share" size={20} className="text-secondary" />
            <h2 className="text-[16px] font-semibold text-on-surface font-geist">Share Quiz</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-on-surface transition-colors">
            <Icon name="close" size={20} />
          </button>
        </div>

        {!created ? (
          <>
            <div className="flex flex-col gap-4">
              {/* Guest Name */}
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-on-surface font-geist">Guest Name <span className="text-error">*</span></label>
                <input
                  className="w-full bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal transition-colors"
                  placeholder="e.g. John Doe"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Max Attempts */}
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-on-surface font-geist">Max Attempts <span className="text-text-muted font-normal">(optional)</span></label>
                <input
                  type="number"
                  min={1}
                  className="w-full bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal transition-colors"
                  placeholder="Unlimited"
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                />
              </div>

              {/* Expiry */}
              <div className="space-y-1.5">
                <label className="block text-[12px] font-medium text-on-surface font-geist">Expires At <span className="text-text-muted font-normal">(optional)</span></label>
                <input
                  type="datetime-local"
                  className="w-full bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-accent-teal transition-colors"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>

            {error && <div className="bg-error-container border border-error/30 rounded-lg p-3 text-[13px] text-on-error-container">{error}</div>}

            <div className="flex gap-3 justify-end">
              <button onClick={onClose} className="px-4 py-2 border border-border-subtle rounded text-[12px] text-text-muted hover:text-on-surface transition-colors">
                Cancel
              </button>
              <button
                onClick={() => void create()}
                disabled={loading || !guestName.trim()}
                className="px-4 py-2 bg-secondary hover:opacity-90 disabled:opacity-50 text-on-secondary-fixed rounded text-[12px] font-medium transition-colors flex items-center gap-2"
              >
                {loading && <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                Generate Link
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-text-muted">Share link created for <span className="text-on-surface font-medium">{created.guestName}</span></p>
              <div className="flex items-center gap-2 bg-[#0D0D0D] border border-border-subtle rounded px-3 py-2">
                <span className="flex-1 text-[12px] text-secondary truncate font-mono">{shareUrl}</span>
                <button
                  onClick={copy}
                  className="shrink-0 text-text-muted hover:text-secondary transition-colors"
                  title="Copy link"
                >
                  <Icon name={copied ? 'check' : 'content_copy'} size={18} className={copied ? 'text-success' : ''} />
                </button>
              </div>
              {created.maxAttempts !== null && (
                <p className="text-[11px] text-text-muted">Max attempts: {created.maxAttempts}</p>
              )}
              {created.expiresAt && (
                <p className="text-[11px] text-text-muted">Expires: {new Date(created.expiresAt).toLocaleString()}</p>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={copy}
                className="px-4 py-2 border border-border-subtle rounded text-[12px] text-text-muted hover:text-secondary hover:border-secondary transition-colors flex items-center gap-2"
              >
                <Icon name={copied ? 'check' : 'content_copy'} size={16} />
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <button onClick={onClose} className="px-4 py-2 bg-surface-variant rounded text-[12px] text-on-surface hover:opacity-90 transition-colors">
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
