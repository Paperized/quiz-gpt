import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupQuizWizardPage } from './GroupQuizWizardPage';
import { QuizzesContext } from '../context';
import { req } from '../api';

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);

function renderPage() {
  return render(
    <QuizzesContext.Provider value={{
      quizzes: [],
      groups: [],
      reload: vi.fn(async () => {}),
      reloadGroups: vi.fn(async () => {})
    }}>
      <MemoryRouter>
        <GroupQuizWizardPage />
      </MemoryRouter>
    </QuizzesContext.Provider>
  );
}

describe('GroupQuizWizardPage', () => {
  beforeEach(() => {
    reqMock.mockReset();
  });

  it('shows model and embedding selectors', async () => {
    reqMock.mockResolvedValueOnce([]); // models fetch
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Group Topic or Instruction')).toBeInTheDocument();
    });

    // Select elements for Model and Embedding
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });

  it('submits model IDs with proposal request', async () => {
    reqMock.mockResolvedValueOnce([
      { id: 'llm-1', label: 'Test LLM', modelType: 'llm', provider: 'openai', modelId: 'gpt-4o', apiKeyMasked: '••••••••', baseUrl: null, providerId: null, maxTokens: null, temperature: null, maxRetrievedChunks: null, maxRetrievedChars: null, maxEmbeddingCandidates: null, embeddingBatchSize: null, createdBy: 'u1', isSystem: false, isDefault: true, assignedTo: null, createdAt: '', updatedAt: '' },
      { id: 'emb-1', label: 'Test Emb', modelType: 'embedding', provider: 'openai', modelId: 'text-embedding-3-small', apiKeyMasked: '••••••••', baseUrl: null, providerId: null, maxTokens: null, temperature: null, maxRetrievedChunks: null, maxRetrievedChars: null, maxEmbeddingCandidates: null, embeddingBatchSize: null, createdBy: 'u1', isSystem: false, isDefault: true, assignedTo: null, createdAt: '', updatedAt: '' }
    ]);
    reqMock.mockResolvedValueOnce({ jobId: 'job-proposal-1' });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Group Topic or Instruction')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Build a group of quizzes/i), {
      target: { value: 'Test group topic' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Propose Group Quiz/i }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledTimes(2);
    });

    // Second call should be the proposal request
    const formData = reqMock.mock.calls[1][1]?.body as FormData;
    expect(formData.get('llmModelId')).toBe('llm-1');
    expect(formData.get('embeddingModelId')).toBe('emb-1');
  });
});
