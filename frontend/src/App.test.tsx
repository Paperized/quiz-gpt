import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const { authProviderMock, adminAppMock } = vi.hoisted(() => ({
  authProviderMock: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="auth-provider">{children}</div>),
  adminAppMock: vi.fn(({ children }: { children: React.ReactNode }) => <div data-testid="admin-app">{children}</div>)
}));

vi.mock('./auth.js', () => ({
  AuthProvider: authProviderMock
}));

vi.mock('./context', () => ({
  AdminApp: adminAppMock
}));

vi.mock('./components/Layout', () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('./components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock('./pages/LoginPage', () => ({
  LoginPage: () => <div>Login page</div>
}));

vi.mock('./pages/RegisterPage', () => ({
  RegisterPage: () => <div>Register page</div>
}));

vi.mock('./pages/CreateQuizPage', () => ({
  CreateQuizPage: () => <div>Create quiz</div>
}));

vi.mock('./pages/QuizPage', () => ({
  QuizPage: () => <div>Quiz page</div>
}));

vi.mock('./pages/ReviewPage', () => ({
  ReviewPage: () => <div>Review page</div>
}));

vi.mock('./pages/ResultsPage', () => ({
  ResultsPage: () => <div>Results page</div>
}));

vi.mock('./pages/SharesPage', () => ({
  SharesPage: () => <div>Shares page</div>
}));

vi.mock('./pages/GuestQuizPage', () => ({
  GuestQuizPage: () => <div>Guest quiz</div>
}));

vi.mock('./pages/GroupQuizWizardPage', () => ({
  GroupQuizWizardPage: () => <div>Group quiz</div>
}));

vi.mock('./pages/AdminPage', () => ({
  AdminPage: () => <div>Admin page</div>
}));

vi.mock('./pages/ModelsPage', () => ({
  ModelsPage: () => <div>Models page</div>
}));

vi.mock('./pages/ProfilePage', () => ({
  ProfilePage: () => <div>Profile page</div>
}));

describe('App routing shells', () => {
  beforeEach(() => {
    authProviderMock.mockClear();
    adminAppMock.mockClear();
    window.history.replaceState({}, '', '/');
  });

  it('does not mount auth or admin shells on guest routes', () => {
    window.history.replaceState({}, '', '/public/s/token-1');

    render(<App />);

    expect(screen.getByText('Guest quiz')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-app')).not.toBeInTheDocument();
  });

  it('mounts auth shell for authenticated app routes', () => {
    render(<App />);

    expect(screen.getByText('Create quiz')).toBeInTheDocument();
    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    expect(screen.getByTestId('admin-app')).toBeInTheDocument();
  });
});
