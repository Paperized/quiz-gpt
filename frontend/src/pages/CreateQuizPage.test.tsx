import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateQuizPage } from './CreateQuizPage';
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

function renderPage(reload = vi.fn(async () => {})) {
  return render(
    <QuizzesContext.Provider value={{
      quizzes: [],
      groups: [],
      reload,
      reloadGroups: vi.fn(async () => {})
    }}>
      <MemoryRouter>
        <CreateQuizPage />
      </MemoryRouter>
    </QuizzesContext.Provider>
  );
}

describe('CreateQuizPage difficulty control', () => {
  beforeEach(() => {
    reqMock.mockReset();
    useNavigateMock.mockReset();
    useNavigateMock.mockReturnValue(vi.fn());
  });

  it('shows the numeric difficulty legend and submits difficulty as a number', async () => {
    reqMock.mockResolvedValueOnce([]);           // models fetch
    reqMock.mockResolvedValueOnce({ jobId: 'job-1' }); // generate

    renderPage();

    expect(screen.getByText('5/10')).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Generate a quiz about/i), {
      target: { value: 'Build a Linux quiz' }
    });
    fireEvent.change(screen.getByLabelText('Difficulty'), {
      target: { value: '9' }
    });

    expect(screen.getByText('9/10')).toBeInTheDocument();
    expect(screen.getByText('Expert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Generate Quiz/i }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledTimes(2);
    });

    const formData = reqMock.mock.calls[1][1]?.body as FormData;
    const rawSettings = formData.get('settings');
    expect(typeof rawSettings).toBe('string');
    expect(JSON.parse(rawSettings as string)).toMatchObject({
      difficulty: 9
    });
  });

  it('auto-adjusts choices when switching to true/false only', async () => {
    reqMock.mockResolvedValueOnce([]);
    reqMock.mockResolvedValueOnce({ jobId: 'job-2' });

    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/Generate a quiz about/i), {
      target: { value: 'Build a Linux quiz' }
    });

    fireEvent.click(screen.getByRole('button', { name: /multiple choice/i }));
    fireEvent.click(screen.getByLabelText('Multiple Choice'));
    fireEvent.click(screen.getByLabelText('Multi Select'));

    expect(screen.queryByText('Choices per Question')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate quiz/i }));

    await waitFor(() => {
      expect(reqMock).toHaveBeenCalledTimes(2);
    });

    const formData = reqMock.mock.calls[1][1]?.body as FormData;
    expect(JSON.parse(formData.get('settings') as string)).toMatchObject({
      questionType: ['true_false'],
      choicesPerQuestion: 2
    });
  });

  it('shows an API error when quiz generation fails', async () => {
    reqMock.mockResolvedValueOnce([]);
    reqMock.mockRejectedValueOnce(new Error('Generation failed'));

    renderPage();

    fireEvent.change(screen.getByPlaceholderText(/Generate a quiz about/i), {
      target: { value: 'Build a Linux quiz' }
    });
    fireEvent.click(screen.getByRole('button', { name: /generate quiz/i }));

    expect(await screen.findByText('Generation failed')).toBeInTheDocument();
  });

  it('reloads quizzes and navigates when the generation job completes', async () => {
    const reloadMock = vi.fn(async () => {});
    const navigateMock = vi.fn();
    useNavigateMock.mockReturnValue(navigateMock);
    reqMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ jobId: 'job-3' })
      .mockResolvedValueOnce({
        id: 'job-3',
        kind: 'quiz_generate',
        status: 'completed',
        currentStep: 'Saving result',
        stepIndex: 6,
        stepTotal: 6,
        doneCount: null,
        totalCount: null,
        message: null,
        resultPayload: { id: 'quiz-42' },
        error: null,
        createdAt: '',
        updatedAt: ''
      });

    renderPage(reloadMock);

    fireEvent.change(screen.getByPlaceholderText(/Generate a quiz about/i), {
      target: { value: 'Build a Linux quiz' }
    });
    fireEvent.click(screen.getByRole('button', { name: /generate quiz/i }));

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalled();
      expect(navigateMock).toHaveBeenCalledWith('/quiz/quiz-42');
    });
  });
});
