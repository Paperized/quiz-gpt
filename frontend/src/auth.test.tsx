import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth';
import { req } from './api';

vi.mock('./api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

function Consumer() {
  const auth = useAuth();
  return (
    <div>
      <span>loading:{String(auth.loading)}</span>
      <span>user:{auth.user ? auth.user.email : 'none'}</span>
      <span>status:{auth.status ? 'loaded' : 'none'}</span>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('does not call private auth endpoints on public routes', async () => {
    render(
      <MemoryRouter initialEntries={['/public/s/token-1']}>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('loading:false')).toBeInTheDocument();
    });

    expect(screen.getByText('user:none')).toBeInTheDocument();
    expect(screen.getByText('status:none')).toBeInTheDocument();
    expect(reqMock).not.toHaveBeenCalled();
  });

  it('loads auth status and current user on private routes', async () => {
    reqMock
      .mockResolvedValueOnce({ hasUsers: true, oidcEnabled: false, emailEnabled: true })
      .mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: null,
        role: 'user',
        authProvider: 'email',
        encryptionConfigured: true
      });

    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('loading:false')).toBeInTheDocument();
    });

    expect(screen.getByText('user:user@example.com')).toBeInTheDocument();
    expect(screen.getByText('status:loaded')).toBeInTheDocument();
    expect(reqMock).toHaveBeenCalledWith('/api/auth/status');
    expect(reqMock).toHaveBeenCalledWith('/api/auth/me');
  });
});
