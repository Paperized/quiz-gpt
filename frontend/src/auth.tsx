import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { req } from './api.js';
import type { AuthUser, AuthStatus } from './types.js';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  status: AuthStatus | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  status: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isPublicRoute = location.pathname.startsWith('/public/');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const u = await req<AuthUser>('/api/auth/me');
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPublicRoute) {
      setUser(null);
      setStatus(null);
      setLoading(false);
      return;
    }

    // Fetch auth status first (to know if login/register are available)
    req<AuthStatus>('/api/auth/status')
      .then(setStatus)
      .catch(() => {});
    refresh();
  }, [isPublicRoute, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await req<AuthUser>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setUser(u);
  }, []);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const u = await req<AuthUser>('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: name || undefined }),
    });
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await req('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user, loading, status, login, register, logout, refresh,
  }), [user, loading, status, login, register, logout, refresh]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
