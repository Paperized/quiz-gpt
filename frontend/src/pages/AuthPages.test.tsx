import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { useAuth } from '../auth';

vi.mock('../auth', () => ({
  useAuth: vi.fn()
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn()
  };
});

const useAuthMock = vi.mocked(useAuth);
const useNavigateMock = vi.mocked(useNavigate);

function renderWithRouter(node: React.ReactNode, initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={node} />
        <Route path="/login" element={<div>Login route</div>} />
        <Route path="/register" element={<div>Register route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('auth pages and guards', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    useNavigateMock.mockReset();
    useNavigateMock.mockReturnValue(vi.fn());
  });

  it('redirects unauthenticated users to register when no users exist yet', () => {
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: false, oidcEnabled: false, emailEnabled: true },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(
      <ProtectedRoute>
        <div>Private content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Register route')).toBeInTheDocument();
  });

  it('shows a spinner while auth state is loading', () => {
    useAuthMock.mockReturnValue({
      user: null,
      loading: true,
      status: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    const { container } = renderWithRouter(
      <ProtectedRoute>
        <div>Private content</div>
      </ProtectedRoute>
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows an admin access message for non-admin users on admin-only routes', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'user-1', email: 'user@example.com', name: null, role: 'user', authProvider: 'email', encryptionConfigured: true },
      loading: false,
      status: { hasUsers: true, oidcEnabled: false, emailEnabled: true },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(
      <ProtectedRoute adminOnly>
        <div>Admin content</div>
      </ProtectedRoute>
    );

    expect(screen.getByText('Admin access required')).toBeInTheDocument();
  });

  it('shows both SSO and email login when both auth methods are enabled', () => {
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: true, oidcEnabled: true, emailEnabled: true },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(<LoginPage />);

    expect(screen.getByRole('link', { name: /login with sso/i })).toHaveAttribute('href', '/api/auth/login/oidc');
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows registration disabled message when email signup is turned off', () => {
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: true, oidcEnabled: true, emailEnabled: false },
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(<RegisterPage />);

    expect(screen.getByText('Registration Disabled')).toBeInTheDocument();
    expect(screen.getByText('Email registration is not available.')).toBeInTheDocument();
  });

  it('submits login credentials and navigates on success', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: true, oidcEnabled: false, emailEnabled: true },
      login: loginMock,
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'supersecret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('user@example.com', 'supersecret');
      expect(navigateMock).toHaveBeenCalledWith('/');
    });
  });

  it('shows a login error when authentication fails', async () => {
    const loginMock = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: true, oidcEnabled: false, emailEnabled: true },
      login: loginMock,
      register: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });

  it('blocks registration locally when the password is too short', async () => {
    const registerMock = vi.fn();
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: false, oidcEnabled: false, emailEnabled: true },
      login: vi.fn(),
      register: registerMock,
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(<RegisterPage />);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('submits registration and navigates on success', async () => {
    const registerMock = vi.fn().mockResolvedValue(undefined);
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);
    useAuthMock.mockReturnValue({
      user: null,
      loading: false,
      status: { hasUsers: true, oidcEnabled: false, emailEnabled: true },
      login: vi.fn(),
      register: registerMock,
      logout: vi.fn(),
      refresh: vi.fn()
    });

    renderWithRouter(<RegisterPage />);

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'User' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'supersecret' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(registerMock).toHaveBeenCalledWith('user@example.com', 'supersecret', 'User');
      expect(navigateMock).toHaveBeenCalledWith('/');
    });
  });
});
