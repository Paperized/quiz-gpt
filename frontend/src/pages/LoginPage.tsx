import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.js';
import { Icon } from '../components/Icon.js';

export function LoginPage() {
  const { user, loading, status, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  // If no users exist, redirect to register
  if (status && !status.hasUsers && status.emailEnabled) {
    return <Navigate to="/register" replace />;
  }

  const canEmailLogin = status?.emailEnabled ?? false;
  const canOidcLogin = status?.oidcEnabled ?? false;

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
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
          <h1 className="text-[20px] font-bold text-on-surface font-geist">QuizGPT</h1>
        </div>

        {canOidcLogin && (
          <div className="mb-6">
            <a
              href="/api/auth/login/oidc"
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 rounded-lg bg-primary text-on-primary font-medium text-[14px] hover:opacity-90 transition-opacity"
            >
              <Icon name="lock" size={16} />
              Login with SSO
            </a>
          </div>
        )}

        {canOidcLogin && canEmailLogin && (
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-border-subtle" />
            <span className="text-[11px] text-text-muted uppercase">or</span>
            <div className="flex-1 h-px bg-border-subtle" />
          </div>
        )}

        {canEmailLogin && (
          <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
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
                className="w-full px-3 py-2 rounded-lg border border-border-subtle bg-surface text-[14px] text-on-surface placeholder:text-text-muted focus:outline-none focus:border-primary"
                placeholder="••••••••"
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
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
            {status && !status.hasUsers && (
              <p className="text-center text-[12px] text-text-muted">
                No account yet? <a href="/register" className="text-primary hover:underline">Register</a>
              </p>
            )}
          </form>
        )}

        {!canOidcLogin && !canEmailLogin && (
          <p className="text-center text-[14px] text-text-muted">
            No authentication methods configured.
          </p>
        )}
      </div>
    </div>
  );
}
