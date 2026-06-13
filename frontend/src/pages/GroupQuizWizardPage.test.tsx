import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupQuizWizardPage } from './GroupQuizWizardPage';
import { QuizzesContext } from '../context';
import { req } from '../api';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn()
  };
});

vi.mock('../api', () => ({
  req: vi.fn()
}));

const reqMock = vi.mocked(req);
const useNavigateMock = vi.mocked(useNavigate);

function renderPage({ reload = vi.fn(async () => {}), reloadGroups = vi.fn(async () => {}) } = {}) {
  return render(
    <QuizzesContext.Provider value={{
      quizzes: [],
      groups: [],
      reload,
      reloadGroups
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
    useNavigateMock.mockReset();
    useNavigateMock.mockReturnValue(vi.fn());
    localStorage.clear();
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

  it('blocks proposal when min quiz count is greater than max quiz count', async () => {
    reqMock.mockResolvedValueOnce([]);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Group Topic or Instruction')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Build a group of quizzes/i), {
      target: { value: 'Test group topic' }
    });

    const ranges = screen.getAllByRole('slider');
    const [minRange, maxRange] = ranges.slice(-2);
    fireEvent.change(minRange, { target: { value: '5' } });
    fireEvent.change(maxRange, { target: { value: '2' } });

    fireEvent.click(screen.getByRole('button', { name: /propose group quiz/i }));

    expect(await screen.findByText('Minimum quiz count cannot be greater than maximum quiz count')).toBeInTheDocument();
    expect(reqMock).toHaveBeenCalledTimes(1);
  });

  it('shows proposal request errors', async () => {
    reqMock.mockResolvedValueOnce([]);
    reqMock.mockRejectedValueOnce(new Error('Proposal failed'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Group Topic or Instruction')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Build a group of quizzes/i), {
      target: { value: 'Test group topic' }
    });
    fireEvent.click(screen.getByRole('button', { name: /propose group quiz/i }));

    expect(await screen.findByText('Proposal failed')).toBeInTheDocument();
  });

  it('enters phase 2 after a completed proposal job and can go back to phase 1', async () => {
    reqMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ jobId: 'job-proposal-2' })
      .mockResolvedValueOnce({
        id: 'job-proposal-2',
        kind: 'group_propose',
        status: 'completed',
        currentStep: 'Saving result',
        stepIndex: 6,
        stepTotal: 6,
        doneCount: null,
        totalCount: null,
        message: null,
        resultPayload: {
          groupTitle: 'Architecture Track',
          items: [{ title: 'Backend', focus: 'Routes and auth' }]
        },
        error: null,
        createdAt: '',
        updatedAt: ''
      });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Group Topic or Instruction')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Build a group of quizzes/i), {
      target: { value: 'Test group topic' }
    });
    fireEvent.click(screen.getByRole('button', { name: /propose group quiz/i }));

    expect(await screen.findByText('Phase 2: Review and Edit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to phase 1/i }));

    expect(await screen.findByText('Phase 1: Proposal Setup')).toBeInTheDocument();
  });

  it('generates the group from phase 2 and navigates to the first quiz', async () => {
    const reloadMock = vi.fn(async () => {});
    const reloadGroupsMock = vi.fn(async () => {});
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);
    reqMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ jobId: 'job-proposal-3' })
      .mockResolvedValueOnce({
        id: 'job-proposal-3',
        kind: 'group_propose',
        status: 'completed',
        currentStep: 'Saving result',
        stepIndex: 6,
        stepTotal: 6,
        doneCount: null,
        totalCount: null,
        message: null,
        resultPayload: {
          groupTitle: 'Architecture Track',
          items: [{ title: 'Backend', focus: 'Routes and auth' }]
        },
        error: null,
        createdAt: '',
        updatedAt: ''
      })
      .mockResolvedValueOnce({ jobId: 'job-generate-1' })
      .mockResolvedValueOnce({
        id: 'job-generate-1',
        kind: 'group_generate',
        status: 'completed',
        currentStep: 'Saving result',
        stepIndex: 6,
        stepTotal: 6,
        doneCount: 1,
        totalCount: 1,
        message: null,
        resultPayload: {
          groupId: 'group-1',
          quizzes: [{ id: 'quiz-1' }],
          errors: []
        },
        error: null,
        createdAt: '',
        updatedAt: ''
      });

    renderPage({ reload: reloadMock, reloadGroups: reloadGroupsMock });

    await waitFor(() => {
      expect(screen.getByText('Group Topic or Instruction')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Build a group of quizzes/i), {
      target: { value: 'Test group topic' }
    });
    fireEvent.click(screen.getByRole('button', { name: /propose group quiz/i }));

    expect(await screen.findByText('Phase 2: Review and Edit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /generate group quiz/i }));

    await waitFor(() => {
      expect(reloadGroupsMock).toHaveBeenCalled();
      expect(reloadMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/quiz/quiz-1');
    });
  });
});
