import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';
import { req } from '../api';
import type { AuthUser, Model, Provider } from '../types';

vi.mock('../api', () => ({
  req: vi.fn()
}));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'admin-1', email: 'admin@test.com', name: 'Admin', role: 'admin', authProvider: 'email', encryptionConfigured: true },
    loading: false,
    status: { hasUsers: true, oidcEnabled: false, emailEnabled: true } as const
  })
}));

const reqMock = vi.mocked(req);

const users: AuthUser[] = [
  { id: 'admin-1', email: 'admin@test.com', name: 'Admin', role: 'admin', authProvider: 'email', encryptionConfigured: true },
  { id: 'user-1', email: 'user1@test.com', name: 'User One', role: 'user', authProvider: 'email', encryptionConfigured: true },
  { id: 'user-2', email: 'user2@test.com', name: 'User Two', role: 'user', authProvider: 'email', encryptionConfigured: true }
];

const providers: Provider[] = [
  {
    id: 'prov-system',
    label: 'System Provider',
    provider: 'openai',
    baseUrl: null,
    apiKeyMasked: 'sk-****',
    createdBy: 'admin-1',
    isSystem: true,
    assignedTo: ['user-1'],
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z'
  }
];

const models: Model[] = [
  {
    id: 'model-system',
    label: 'System Model',
    modelType: 'llm',
    provider: 'openai',
    modelId: 'gpt-4o',
    apiKeyMasked: 'sk-****',
    baseUrl: null,
    providerId: null,
    maxTokens: null,
    temperature: null,
    maxRetrievedChunks: null,
    maxRetrievedChars: null,
    maxEmbeddingCandidates: null,
    embeddingBatchSize: null,
    createdBy: 'admin-1',
    isSystem: true,
    isDefault: false,
    assignedTo: ['user-1'],
    createdAt: '2026-06-14T10:00:00.000Z',
    updatedAt: '2026-06-14T10:00:00.000Z'
  }
];

function installDefaultReqMock() {
  reqMock.mockImplementation(async (path, init) => {
    if (path === '/api/users' && !init) return structuredClone(users);
    if (path === '/api/providers' && !init) return structuredClone(providers);
    if (path === '/api/models' && !init) return structuredClone(models);
    if (path === '/api/users/user-1' && init?.method === 'PATCH') return undefined;
    if (path === '/api/providers/prov-system/access' && init?.method === 'POST') return undefined;
    if (path === '/api/models/model-system/access' && init?.method === 'POST') return undefined;
    if (path === '/api/users' && init?.method === 'POST') return undefined;
    throw new Error(`Unhandled req mock: ${path} ${init?.method ?? 'GET'}`);
  });
}

function renderPage() {
  return render(<AdminPage />);
}

describe('AdminPage', () => {
  beforeEach(() => {
    reqMock.mockReset();
    installDefaultReqMock();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('loads admin data and promotes a user', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('User One')).toBeInTheDocument();
    });

    const userOneCell = screen.getByText('User One').closest('td');
    const userOneRow = userOneCell?.parentElement as HTMLElement;
    fireEvent.click(within(userOneRow).getByRole('button', { name: 'Promote to admin' }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledWith(
        '/api/users/user-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ role: 'admin' })
        })
      );
    });
  });

  it('validates create user password locally before calling the API', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new user/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /new user/i }));
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'new@test.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password (min 8 chars)'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    expect(await screen.findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(reqMock).not.toHaveBeenCalledWith('/api/users', expect.objectContaining({ method: 'POST' }));
  });

  it('grants provider access from the access panel and refreshes providers', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'providers' }));

    const providerRow = await screen.findByText('System Provider');
    const providerCard = providerRow.closest('div[class*="justify-between"]') ?? providerRow.parentElement?.parentElement;
    expect(providerCard).toBeTruthy();

    fireEvent.click(within(providerCard as HTMLElement).getByTitle('Access'));

    await waitFor(() => {
      expect(screen.getByText('Grant to user')).toBeInTheDocument();
    });

    const accessDialog = screen.getByText('Access').closest('div[class*="max-w-sm"]') as HTMLElement;
    fireEvent.change(within(accessDialog).getByRole('combobox'), { target: { value: 'user-2' } });
    fireEvent.click(within(accessDialog).getByRole('button', { name: 'Grant' }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledWith(
        '/api/providers/prov-system/access',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: 'user-2' })
        })
      );
    });
  });

  it('grants model access from the access panel and refreshes models', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'models' }));

    const modelRow = await screen.findByText('System Model');
    const modelCard = modelRow.closest('div[class*="justify-between"]') ?? modelRow.parentElement?.parentElement;
    expect(modelCard).toBeTruthy();

    fireEvent.click(within(modelCard as HTMLElement).getByTitle('Access'));

    await waitFor(() => {
      expect(screen.getByText('Grant to user')).toBeInTheDocument();
    });

    const accessDialog = screen.getByText('Access').closest('div[class*="max-w-sm"]') as HTMLElement;
    fireEvent.change(within(accessDialog).getByRole('combobox'), { target: { value: 'user-2' } });
    fireEvent.click(within(accessDialog).getByRole('button', { name: 'Grant' }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledWith(
        '/api/models/model-system/access',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: 'user-2' })
        })
      );
    });
  });
});
