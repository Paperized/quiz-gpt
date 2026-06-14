import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsPage } from './ModelsPage';
import { req } from '../api';

vi.mock('../api', () => ({
  req: vi.fn()
}));

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'user@test.com', name: 'User', role: 'user', authProvider: 'email', encryptionConfigured: true },
    loading: false,
    status: { hasUsers: true, oidcEnabled: false, emailEnabled: true } as any
  })
}));

const reqMock = vi.mocked(req);

function renderPage() {
  return render(
    <MemoryRouter>
      <ModelsPage />
    </MemoryRouter>
  );
}

describe('ModelsPage', () => {
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('opens ProviderForm dialog when clicking New Provider', async () => {
    reqMock.mockResolvedValueOnce([]); // providers
    reqMock.mockResolvedValueOnce([]); // models

    renderPage();

    // Switch to providers tab
    fireEvent.click(screen.getByText('providers'));

    await waitFor(() => {
      expect(screen.getByText('New Provider')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Provider'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Label/)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('API Key')).toBeInTheDocument();
      expect(screen.getByText('Create Provider')).toBeInTheDocument();
    });
  });

  it('creates a provider through the dialog form', async () => {
    reqMock.mockResolvedValueOnce([]); // providers list
    reqMock.mockResolvedValueOnce([]); // models list
    reqMock.mockResolvedValueOnce({ ok: true }); // POST /api/providers
    reqMock.mockResolvedValueOnce([]); // refetch providers after create
    reqMock.mockResolvedValueOnce([]); // refetch models after provider change

    renderPage();

    fireEvent.click(screen.getByText('providers'));

    await waitFor(() => {
      expect(screen.getByText('New Provider')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Provider'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Label/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Label/), { target: { value: 'My Provider' } });
    fireEvent.change(screen.getByPlaceholderText('API Key'), { target: { value: 'sk-test' } });
    // Select provider type from dropdown
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByText('Create Provider'));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledWith(
        '/api/providers',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('My Provider') })
      );
    });
  });

  it('shows Edit button in provider detail for non-system provider', async () => {
    const provider = {
      id: 'prov-1', label: 'My Private Provider', provider: 'openai',
      baseUrl: null, apiKeyMasked: 'sk-****', createdBy: 'user-1',
      isSystem: false, assignedTo: null, createdAt: '2026-01-01', updatedAt: '2026-01-01'
    };
    reqMock.mockResolvedValueOnce([provider]); // providers
    reqMock.mockResolvedValueOnce([]); // models

    renderPage();

    fireEvent.click(screen.getByText('providers'));

    await waitFor(() => {
      expect(screen.getByText('My Private Provider')).toBeInTheDocument();
    });

    // Click search icon on the provider row
    const searchIcons = screen.getAllByText('search');
    fireEvent.click(searchIcons[0].closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });
  });

  it('opens edit form when clicking Edit in provider detail', async () => {
    const provider = {
      id: 'prov-1', label: 'My Private Provider', provider: 'openai',
      baseUrl: null, apiKeyMasked: 'sk-****', createdBy: 'user-1',
      isSystem: false, assignedTo: null, createdAt: '2026-01-01', updatedAt: '2026-01-01'
    };
    reqMock.mockResolvedValueOnce([provider]); // providers
    reqMock.mockResolvedValueOnce([]); // models

    renderPage();

    fireEvent.click(screen.getByText('providers'));

    await waitFor(() => {
      expect(screen.getByText('My Private Provider')).toBeInTheDocument();
    });

    // Click search → detail dialog
    const searchIcons = screen.getAllByText('search');
    fireEvent.click(searchIcons[0].closest('button')!);

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    // Click Edit → edit form
    fireEvent.click(screen.getByText('Edit'));

    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });
  });
});
