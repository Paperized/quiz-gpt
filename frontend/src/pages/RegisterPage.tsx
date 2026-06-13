import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { Icon } from '../components/Icon.js';

export function RegisterPage() {
  const { user, loading, status, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  // Only allow register if email is enabled and either no users exist or explicitly navigated
  if (!status?.emailEnabled) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-[18px] font-bold text-on-surface mb-2">Registration Disabled</h2>
          <p className="text-[14px] text-text-muted">Email registration is not available.</p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await register(email, password, name || undefined);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface">
      <div className="w-full max-w-sm p-8 bg-surface-container rounded-xl border border-border-subtle shadow-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded bg-primary-container flex items-center justify-center">
            <Icon name="lightbulb" fill size={20} className="text-secondary" />
          </div>
          <h1 className="text-[20px] font-bold text-on-surface font-geist">Create Account</h1>
        </div>

        {!status?.hasUsers && (
          <div className="mb-4 p-3 rounded-lg bg-primary-container/20 border border-primary/20">
            <p className="text-[12px] text-on-surface">
              You are the first user — you will be the <strong>super admin</strong>.{status?.oidcEnabled && <> When using OIDC, the first user inherits the role from their group (<code>quiz_super_admin</code>, <code>quiz_admin</code>, or <code>quiz_user</code>).</>}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-[12px] font-medium text-text-muted mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[14px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-text-muted mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[14px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-text-muted mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[14px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
              placeholder="At least 8 characters"
            />
          </div>
          {error && (
            <p className="text-error text-[12px]">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-medium text-[14px] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? 'Creating account...' : 'Create account'}
          </button>
          {status?.hasUsers && (
            <p className="text-center text-[12px] text-text-muted">
              Already have an account? <a href="/login" className="text-primary hover:underline">Sign in</a>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
